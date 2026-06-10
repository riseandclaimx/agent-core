import { modelRouter, getProviderClient } from "./router/model-router";
import type { ChatMessage } from "./router/model-router";
import { logger } from "../obs/logger";
import { metrics, METRICS } from "../obs/metrics";
import { generateId } from "../utils/id";

export interface PlanStep {
  id: string;
  description: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  dependsOn?: string[];
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  reasoning?: string;
  createdAt: Date;
}

export interface PlanInput {
  userGoal: string;
  availableTools: string[];
  conversationHistory: ChatMessage[];
  userContext: Record<string, unknown>;
}

const PLANNER_SYSTEM_PROMPT = `You are a planning agent. Given a user goal and available tools, create a step-by-step plan.

Respond ONLY with valid JSON:
{
  "plan": [{"id":"step_1","description":"...","toolName":"tool.name","toolArgs":{},"dependsOn":[]}],
  "reasoning": "..."
}`;

class Planner {
  async createPlan(input: PlanInput): Promise<Plan> {
    const start = Date.now();
    const planId = `plan_${generateId()}`;
    const log = logger.child({ component: "planner" });

    try {
      const model = modelRouter.selectModel({
        taskType: "planning",
        complexity: "medium",
        requiresTools: true,
        requiresVision: false,
        estimatedContextTokens: 1000,
      });

      const client = getProviderClient(model.provider);
      const toolList = input.availableTools.map((t) => `- ${t}`).join("\n");
      const userPrompt = `Goal: ${input.userGoal}\n\nAvailable tools:\n${toolList}\n\nUser context: ${JSON.stringify(input.userContext)}\n\nCreate a plan.`;

      const messages: ChatMessage[] = [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        ...input.conversationHistory.slice(-4),
        { role: "user", content: userPrompt },
      ];

      const response = await client.chat({ model: model.modelId, messages, maxTokens: 1000, temperature: 0.2 });
      const choice = response.choices[0];
      const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
      const steps = this.parseSteps(content, input.userGoal);
      const reasoning = this.parseReasoning(content);

      metrics.timing(METRICS.AGENT_DURATION_MS, start, { phase: "planning" });
      log.info("Plan created", { planId, steps: steps.length });

      return { id: planId, goal: input.userGoal, steps, reasoning, createdAt: new Date() };
    } catch (error) {
      log.warn("Plan generation failed, using fallback", { err: (error as Error).message });
      return this.fallbackPlan(planId, input.userGoal, input.availableTools);
    }
  }

  private parseSteps(content: string, goal: string): PlanStep[] {
    try {
      const parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
      const rawSteps: unknown[] = Array.isArray(parsed.plan) ? parsed.plan : [];
      return rawSteps.map((s: unknown) => {
        const step = s as Record<string, unknown>;
        return {
          id: typeof step.id === "string" ? step.id : `step_${generateId()}`,
          description: typeof step.description === "string" ? step.description : "Execute step",
          toolName: typeof step.toolName === "string" ? step.toolName : undefined,
          toolArgs: typeof step.toolArgs === "object" && step.toolArgs !== null ? (step.toolArgs as Record<string, unknown>) : undefined,
          dependsOn: Array.isArray(step.dependsOn) ? (step.dependsOn as string[]) : [],
          status: "pending" as const,
        };
      });
    } catch { return this.fallbackSteps(goal); }
  }

  private parseReasoning(content: string): string | undefined {
    try {
      const parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
      return typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
    } catch { return undefined; }
  }

  private fallbackPlan(planId: string, goal: string, tools: string[]): Plan {
    return { id: planId, goal, steps: this.fallbackSteps(goal, tools), reasoning: "Fallback plan", createdAt: new Date() };
  }

  private fallbackSteps(goal: string, tools: string[] = []): PlanStep[] {
    return [
      { id: "step_1", description: `Search context: ${goal.slice(0, 80)}`, toolName: tools.includes("memory.search") ? "memory.search" : undefined, toolArgs: tools.includes("memory.search") ? { query: goal } : undefined, dependsOn: [], status: "pending" },
      { id: "step_2", description: `Execute: ${goal.slice(0, 80)}`, dependsOn: ["step_1"], status: "pending" },
      { id: "step_3", description: "Synthesize response", dependsOn: ["step_2"], status: "pending" },
    ];
  }
}

export const planner = new Planner();
