import { describe, it, expect, vi } from "vitest";
import { agent } from "./core";

// Mock dependencies
vi.mock("./planner", () => ({
  planner: {
    createPlan: vi.fn().mockResolvedValue({
      id: "plan_test",
      goal: "test",
      steps: [{ id: "step_1", description: "Test", status: "pending" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
}));

vi.mock("./reactor", () => ({
  reactor: {
    run: vi.fn().mockResolvedValue({
      finalAnswer: "Test response",
      steps: [],
      toolsUsed: ["memory.search"],
      totalTokens: 100,
      totalCost: 0,
    }),
  },
}));

vi.mock("./memory", () => ({
  memory: {
    searchMemories: vi.fn().mockResolvedValue([]),
    getConversationContext: vi.fn().mockResolvedValue(null),
    updateConversationContext: vi.fn().mockResolvedValue(undefined),
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
    writeMemory: vi.fn().mockResolvedValue({ id: "mem_1" }),
  },
}));

vi.mock("./tools/registry", () => ({
  toolRegistry: { getAll: vi.fn().mockReturnValue([{ name: "memory.search", namespace: "memory" }]) },
}));

vi.mock("../obs/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }), withTrace: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }) },
}));

vi.mock("../obs/metrics", () => ({
  metrics: { timing: vi.fn(), gauge: vi.fn() },
  METRICS: { AGENT_DURATION_MS: "agent.duration", AGENT_TOKENS_TOTAL: "agent.tokens", AGENT_COST_USD: "agent.cost" },
}));

describe("Agent", () => {
  it("processes a simple message", async () => {
    const response = await agent.process("Hello", {
      userId: "U123",
      teamId: "T123",
      traceId: "tr_test",
    });

    expect(response).toBeDefined();
    expect(response.text).toBe("Test response");
    expect(response.traceId).toBe("tr_test");
    expect(response.metadata.tokens).toBe(100);
    expect(response.metadata.toolsUsed).toContain("memory.search");
  });

  it("uses planning for complex requests", async () => {
    const response = await agent.process("Create a plan to analyze the quarterly budget and generate a report", {
      userId: "U123",
      teamId: "T123",
      traceId: "tr_test2",
    });

    expect(response.plan).toBeDefined();
    expect(response.reactResult).toBeDefined();
  });

  it("getStatus returns tool info", () => {
    const status = agent.getStatus();
    expect(status.tools).toBeGreaterThan(0);
    expect(status.namespaces).toContain("memory");
  });
});
