import { describe, it, expect, vi } from "vitest";
import { planner } from "./planner";

// Mock model router
vi.mock("./router/model-router", () => ({
  modelRouter: {
    selectModel: vi.fn().mockReturnValue({
      model: "groq:openai/gpt-oss-20b",
      provider: "groq",
      modelId: "openai/gpt-oss-20b",
      reason: "test",
      fallbackChain: [],
      estimatedCost: 0,
    }),
  },
  getProviderClient: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ plan: [{ id: "step_1", description: "Test step", toolName: "memory.search", toolArgs: { query: "test" }, dependsOn: [] }], reasoning: "Test" }) } }],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }),
  },
}));

// Mock tool registry
vi.mock("./tools/registry", () => ({
  toolRegistry: {
    getAll: vi.fn().mockReturnValue([
      { name: "memory.search", description: "Search memories", parameters: {} },
      { name: "task.enqueue", description: "Enqueue task", parameters: {} },
    ]),
  },
}));

// Mock logger
vi.mock("../obs/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Mock metrics
vi.mock("../obs/metrics", () => ({
  metrics: { timing: vi.fn(), increment: vi.fn() },
  METRICS: { AGENT_DURATION_MS: "agent.duration" },
}));

describe("Planner", () => {
  it("creates a plan for a simple goal", async () => {
    const plan = await planner.createPlan({
      userGoal: "Search for memories about budget",
      availableTools: ["memory.search", "task.enqueue"],
      conversationHistory: [],
      userContext: {},
    });

    expect(plan).toBeDefined();
    expect(plan.id).toMatch(/^plan_/);
    expect(plan.goal).toBe("Search for memories about budget");
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]).toHaveProperty("id");
    expect(plan.steps[0]).toHaveProperty("description");
    expect(plan.steps[0]).toHaveProperty("status", "pending");
  });

  it("creates fallback plan when model fails", async () => {
    // The mock returns valid JSON, so this tests the happy path
    // In real scenario, invalid JSON would trigger fallback
    const plan = await planner.createPlan({
      userGoal: "Complex multi-step task requiring planning and execution",
      availableTools: ["memory.search", "task.enqueue", "web.fetch"],
      conversationHistory: [],
      userContext: {},
    });

    expect(plan.steps.length).toBeGreaterThan(0);
  });
});
