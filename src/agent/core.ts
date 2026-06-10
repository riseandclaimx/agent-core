import { planner, Plan, PlanStep } from "./planner";
import { reactor, ReActResult } from "./reactor";
import { memory, MemorySearchOptions } from "./memory";
import { modelRouter } from "./router/model-router";
import { toolRegistry } from "./tools/registry";
import { logger } from "../obs/logger";
import { METRICS } from "../obs/metrics";
import { generateId } from "../utils/id";
import type { ChatMessage } from "./router/model-router";

export interface AgentContext {
  userId: string;
  teamId: string;
  channelId?: string;
  threadTs?: string;
  traceId: string;
  slackUser?: { id: string; name: string; isAdmin: boolean };
  conversationHistory?: ChatMessage[];
  userPreferences?: Record<string, unknown>;
}

export interface AgentResponse {
  text: string;
  blocks?: any[];
  plan?: Plan;
  reactResult?: ReActResult;
  traceId: string;
  metadata: {
    model: string;
    tokens: number;
    cost: number;
    steps: number;
    toolsUsed: string[];
    durationMs: number;
  };
}

export interface AgentOptions {
  usePlanning?: boolean;
  maxPlanSteps?: number;
  maxReactSteps?: number;
  availableTools?: string[];
  stream?: boolean;
  onStream?: (chunk: string) => void;
}

/** Main agent class - Hybrid Plan → ReAct */
export class Agent {
  private defaultOptions: Required<AgentOptions> = {
    usePlanning: true,
    maxPlanSteps: 8,
    maxReactSteps: 15,
    availableTools: [],
    stream: false,
    onStream: () => {},
  };

  /** Process a user message and generate response */
  async process(message: string, context: AgentContext, options: AgentOptions = {}): Promise<AgentResponse> {
    const opts = { ...this.defaultOptions, ...options };
    const log = logger.withTrace(context.traceId).child({ component: "agent" });
    const start = Date.now();

    // Get available tools
    const availableTools = opts.availableTools.length > 0
      ? opts.availableTools
      : toolRegistry.getAll().map((t) => t.name);

    // Build conversation history with memory context
    const enrichedHistory = await this.enrichHistory(context, message);

    let plan: Plan | undefined;
    let reactResult: ReActResult | undefined;

    if (opts.usePlanning && this.shouldPlan(message, availableTools)) {
      // Phase 1: Planning
      log.info("Creating plan");
      plan = await planner.createPlan({
        userGoal: message,
        availableTools,
        conversationHistory: enrichedHistory,
        userContext: context.userPreferences || {},
      });

      // Phase 2: Execute plan with ReAct
      log.info("Executing plan", { planId: plan.id, steps: plan.steps.length });
      reactResult = await this.executePlan(plan, context, opts);
    } else {
      // Direct ReAct
      log.info("Running ReAct directly");
      reactResult = await reactor.run(message, {
        ...context,
        conversationHistory: enrichedHistory,
        availableTools,
      });
    }

    // Format response
    const response = this.formatResponse(reactResult, plan, context, start);

    // Store conversation context
    await this.updateConversationContext(context, message, response.text);

    // Track analytics
    await this.trackAnalytics(context, response);

    return response;
  }

  /** Determine if planning is needed */
  private shouldPlan(message: string, availableTools: string[]): boolean {
    // Plan for complex requests
    const complexIndicators = [
      "plan",
      "create",
      "build",
      "analyze",
      "research",
      "compare",
      "design",
      "implement",
      "workflow",
      "automate",
      "multi-step",
      "step by step",
    ];

    const hasComplexIndicator = complexIndicators.some((w) => message.toLowerCase().includes(w));
    const hasMultipleTools = availableTools.length > 5;
    const isLong = message.length > 200;

    return hasComplexIndicator || hasMultipleTools || isLong;
  }

  /** Execute a plan using ReAct for each step */
  private async executePlan(
    plan: Plan,
    context: AgentContext,
    options: Required<AgentOptions>
  ): Promise<ReActResult> {
    const allSteps: ReActResult["steps"] = [];
    let allTools: string[] = [];
    let totalTokens = 0;
    let totalCost = 0;
    let finalAnswer = "";

    for (const step of plan.steps) {
      if (step.status !== "pending") continue;

      // Check dependencies
      if (step.dependsOn && step.dependsOn.length > 0) {
        const depsMet = step.dependsOn.every((depId) =>
          plan.steps.find((s) => s.id === depId)?.status === "completed"
        );
        if (!depsMet) continue;
      }

      // Build step goal
      const stepGoal = step.toolName
        ? `Execute tool ${step.toolName} with args: ${JSON.stringify(step.toolArgs)}`
        : step.description;

      // Run ReAct for this step
      const result = await reactor.run(stepGoal, {
        ...context,
        availableTools: [step.toolName].filter(Boolean) as string[],
      });

      allSteps.push(...result.steps);
      allTools.push(...result.toolsUsed);
      totalTokens += result.totalTokens;
      totalCost += result.totalCost;

      // Update plan step
      step.status = "completed";
      step.result = result.finalAnswer;

      // If this was the final response step, use its answer
      if (step.description.includes("final") || step.description.includes("response")) {
        finalAnswer = result.finalAnswer;
      }
    }

    // If no final answer from plan steps, synthesize one
    if (!finalAnswer) {
      finalAnswer = this.synthesizeAnswer(plan, allSteps);
    }

    return {
      finalAnswer,
      steps: allSteps,
      toolsUsed: allTools,
      totalTokens,
      totalCost,
    };
  }

  /** Enrich conversation history with relevant memories */
  private async enrichHistory(context: AgentContext, currentMessage: string): Promise<ChatMessage[]> {
    const history = context.conversationHistory || [];

    // Search relevant memories
    const memories = await memory.searchMemories({
      query: currentMessage,
      scope: "global",
      limit: 3,
    });

    const userMemories = context.userId
      ? await memory.searchMemories({
          query: currentMessage,
          scope: "user",
          scopeId: context.userId,
          limit: 2,
        })
      : [];

    const channelMemories = context.channelId
      ? await memory.searchMemories({
          query: currentMessage,
          scope: "channel",
          scopeId: context.channelId,
          limit: 2,
        })
      : [];

    // Build memory context
    const allMemories = [...memories, ...userMemories, ...channelMemories]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (allMemories.length > 0) {
      const memoryContext = allMemories
        .map((m) => `- ${m.memory.content.slice(0, 200)}`)
        .join("\n");

      return [
        { role: "system", content: `Relevant memories:\n${memoryContext}` },
        ...history,
      ];
    }

    return history;
  }

  /** Format final response */
  private formatResponse(
    reactResult: ReActResult,
    plan: Plan | undefined,
    context: AgentContext,
    startTime: number
  ): AgentResponse {
    const durationMs = Date.now() - startTime;

    // Get model used (from first step or default)
    const model = "groq:openai/gpt-oss-20b"; // Would track from router

    return {
      text: reactResult.finalAnswer,
      plan,
      reactResult,
      traceId: context.traceId,
      metadata: {
        model,
        tokens: reactResult.totalTokens,
        cost: reactResult.totalCost,
        steps: reactResult.steps.length,
        toolsUsed: reactResult.toolsUsed,
        durationMs,
      },
    };
  }

  /** Synthesize answer from plan execution */
  private synthesizeAnswer(plan: Plan, steps: ReActResult["steps"]): string {
    const completedSteps = plan.steps.filter((s) => s.status === "completed");
    if (completedSteps.length === 0) return "I wasn't able to complete any steps.";

    const summary = completedSteps
      .map((s) => `✅ ${s.description}${s.result ? `: ${String(s.result).slice(0, 100)}` : ""}`)
      .join("\n");

    return `I've completed the following steps:\n\n${summary}\n\nLet me know if you need anything else!`;
  }

  /** Update conversation context in memory */
  private async updateConversationContext(
    context: AgentContext,
    userMessage: string,
    agentResponse: string
  ): Promise<void> {
    if (!context.channelId) return;

    const existing = await memory.getConversationContext(context.channelId, context.threadTs, context.userId);
    const messageCount = (existing?.messageCount || 0) + 2;

    await memory.updateConversationContext(context.channelId, {
      threadTs: context.threadTs,
      userId: context.userId,
      messageCount,
      tokenEstimate: (existing?.tokenEstimate || 0) + (userMessage.length + agentResponse.length) / 4,
      keyPoints: existing?.keyPoints || [],
      activeTopics: existing?.activeTopics || [],
      summary: `User: ${userMessage.slice(0, 100)}... | Agent: ${agentResponse.slice(0, 100)}...`,
    });
  }

  /** Track analytics event */
  private async trackAnalytics(context: AgentContext, response: AgentResponse): Promise<void> {
    // Would call analytics.track_event tool via toolRegistry.execute()
    // For now, just log
    logger.info("Agent response tracked", {
      eventName: "agent_response",
      userId: context.userId,
      traceId: context.traceId,
      metadata: response.metadata,
    });
  }

  /** Get agent status for debugging */
  getStatus(): { tools: number; namespaces: string[] } {
    const tools = toolRegistry.getAll();
    return {
      tools: tools.length,
      namespaces: [...new Set(tools.map((t) => t.namespace))],
    };
  }
}

export const agent = new Agent();
