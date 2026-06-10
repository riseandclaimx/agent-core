import { modelRouter, RoutingContext, getProviderClient, ChatCompletionRequest, ChatMessage, ToolDefinition } from "./router/model-router";
import { toolRegistry } from "./tools/registry";
import { executeTool } from "./tools/executor";
import { logger } from "../obs/logger";
import { metrics, METRICS } from "../obs/metrics";
import { generateId } from "../utils/id";

function getToolSchemas() {
  return toolRegistry.getFunctionSchemas();
}

export interface ReActStep {
  id: string;
  type: "thought" | "action" | "observation";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  timestamp: Date;
}

export interface ReActResult {
  finalAnswer: string;
  steps: ReActStep[];
  toolsUsed: string[];
  totalTokens: number;
  totalCost: number;
}

const REACT_SYSTEM_PROMPT = `You are an autonomous agent using the ReAct (Reasoning + Acting) pattern.

You have access to tools. For each step, you MUST respond with ONE of:

1. THOUGHT: Your reasoning about what to do next
   Format: {"type": "thought", "content": "I need to..."}

2. ACTION: Call a tool
   Format: {"type": "action", "tool": "namespace.tool", "args": {...}}

3. OBSERVATION: Tool result (auto-filled by system)

4. FINAL: Provide final answer to user
   Format: {"type": "final", "content": "Your answer here"}

Rules:
- Think step by step
- Use tools when you need information or need to act
- Don't make up tool results - wait for observations
- Be concise but thorough
- If stuck, ask for clarification

Available tools: {{TOOLS}}`;

export class Reactor {
  private maxSteps = 15;

  /** Run ReAct loop for a single goal */
  async run(
    goal: string,
    context: {
      userId: string;
      teamId: string;
      channelId?: string;
      threadTs?: string;
      traceId: string;
      conversationHistory?: ChatMessage[];
      availableTools?: string[];
    }
  ): Promise<ReActResult> {
    const log = logger.withTrace(context.traceId).child({ component: "reactor" });
    const start = Date.now();

    const steps: ReActStep[] = [];
    const toolsUsed: string[] = [];
    let totalTokens = 0;
    let totalCost = 0;

    // Build available tools list
    const availableToolNames = context.availableTools || getToolSchemas().map((t) => t.function.name);
    const tools = availableToolNames
      .map((name) => toolRegistry.get(name as any))
      .filter(Boolean)
      .map((t) => `${t!.name}: ${t!.description}`)
      .join("\n");

    const systemPrompt = REACT_SYSTEM_PROMPT.replace("{{TOOLS}}", tools);

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...(context.conversationHistory || []).slice(-4),
      { role: "user", content: `Goal: ${goal}` },
    ];

    for (let stepNum = 0; stepNum < this.maxSteps; stepNum++) {
      const routingContext: RoutingContext = {
        taskType: "react",
        complexity: "medium",
        requiresTools: true,
        requiresVision: false,
        estimatedContextTokens: this.estimateTokens(messages),
      };

      const routing = modelRouter.selectModel(routingContext);
      const client = getProviderClient(routing.provider);

      const request: ChatCompletionRequest = {
        model: routing.modelId,
        messages,
        temperature: 0.2,
        maxTokens: 1500,
        tools: getToolSchemas() as any,
        toolChoice: "auto",
      };

      let response;
      try {
        response = await client.chat(request);
      } catch (error) {
        log.error("Model call failed", error as Error, { step: stepNum });
        // Try fallback
        if (routing.fallbackChain.length > 0) {
          continue; // Next iteration will try fallback via router
        }
        throw error;
      }

      totalTokens += response.usage.totalTokens;
      totalCost += modelRouter.estimateCost(routing.model, response.usage.promptTokens, response.usage.completionTokens);

      const choice = response.choices[0];
      if (!choice) continue;
      const message = choice.message;

      // Handle tool calls
      if (message.toolCalls && message.toolCalls.length > 0) {
        for (const toolCall of message.toolCalls) {
          const toolName = toolCall.function.name as any;
          let toolArgs: Record<string, unknown>;
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          // Record thought
          steps.push({
            id: generateId("react"),
            type: "thought",
            content: `Calling ${toolName} with ${JSON.stringify(toolArgs)}`,
            timestamp: new Date(),
          });

          // Record action
          steps.push({
            id: generateId("react"),
            type: "action",
            content: `Executing ${toolName}`,
            toolName,
            toolArgs,
            timestamp: new Date(),
          });

          toolsUsed.push(toolName);

          // Execute tool
          const execResult = await executeTool(
            toolName,
            toolArgs,
            {
              userId: context.userId,
              teamId: context.teamId,
              traceId: context.traceId,
              step: stepNum,
              
            },
            { maxRetries: 2, timeout: 30000 }
          );

          // Record observation
          steps.push({
            id: generateId("react"),
            type: "observation",
            content: execResult.success
              ? `Result: ${JSON.stringify(execResult.result).slice(0, 500)}`
              : `Error: ${execResult.error}`,
            toolName,
            toolResult: execResult.success ? execResult.result : { error: execResult.error },
            timestamp: new Date(),
          });

          // Add to messages for next iteration
          messages.push({
            role: "assistant",
            content: "" as any,
            toolCalls: [
              {
                id: toolCall.id,
                type: "function",
                function: { name: toolCall.function.name, arguments: toolCall.function.arguments },
              },
            ],
          });

          messages.push({
            role: "tool",
            content: execResult.success
              ? JSON.stringify(execResult.result)
              : `Error: ${execResult.error}`,
            toolCallId: toolCall.id,
          });
        }
        continue; // Next iteration
      }

      // Handle text response (thought or final)
      const content = typeof message.content === "string" ? message.content : "";
      let parsed: { type: string; content: string } | null = null;

      try {
        parsed = JSON.parse(content);
      } catch {
        // Not JSON, treat as thought
        parsed = { type: "thought", content };
      }

      if (parsed?.type === "final") {
        steps.push({
          id: generateId("react"),
          type: "thought",
          content: parsed?.content || "",
          timestamp: new Date(),
        });

        metrics.timing(METRICS.AGENT_DURATION_MS, start, { operation: "react" });
        metrics.gauge(METRICS.AGENT_TOKENS_TOTAL, totalTokens);
        metrics.gauge(METRICS.AGENT_COST_USD, totalCost);

        log.info("ReAct completed", { steps: steps.length, toolsUsed: toolsUsed.length, tokens: totalTokens });

        return {
          finalAnswer: parsed?.content || "",
          steps,
          toolsUsed,
          totalTokens,
          totalCost,
        };
      }

      // Thought
      steps.push({
        id: generateId("react"),
        type: "thought",
        content: parsed?.content || "",
        timestamp: new Date(),
      });

      messages.push({ role: "assistant", content: parsed?.content || "" });
    }

    // Max steps reached
    log.warn("ReAct max steps reached", undefined);
    return {
      finalAnswer: "I've reached the maximum number of steps. Let me summarize what I've done so far.",
      steps,
      toolsUsed,
      totalTokens,
      totalCost,
    };
  }

  private estimateTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const m of messages) {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
      total += content.length / 4;
    }
    return total;
  }
}

export const reactor = new Reactor();
