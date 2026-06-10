import { describe, it, expect, vi } from "vitest";
import { reactor } from "./reactor";

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
    estimateCost: vi.fn().mockReturnValue(0),
  },
  getProviderClient: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ type: "final", content: "Task completed!" }), toolCalls: null }],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }),
  },
}));

// Mock tool registry
vi.mock("./tools/registry", () => ({
  toolRegistry: {
    getAll: vi.fn().mockReturnValue([]),
    getFunctionSchemas: vi.fn().mockReturnValue([]),
  },
  getToolSchemas: vi.fn().mockReturnValue([]),
}));

// Mock executor
vi.mock("./tools/executor", () => ({
  executeTool: vi.fn().mockResolvedValue({ success: true, result: { data: "test" } }),
}));

// Mock logger
vi.mock("../obs/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }), withTrace: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }) },
}));

// Mock metrics
vi.mock("../obs/metrics", () => ({
  metrics: { timing: vi.fn(), gauge: vi.fn() },
  METRICS: { AGENT_DURATION_MS: "agent.duration", AGENT_TOKENS_TOTAL: "agent.tokens", AGENT_COST_USD: "agent.cost" },
}));

describe("Reactor", () => {
  it("runs ReAct loop and returns final answer", async () => {
    const result = await reactor.run("Simple question", {
      userId: "U123",
      teamId: "T123",
      traceId: "tr_test",
    });

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBe("Task completed!");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it("handles tool calls in ReAct loop", async () => {
    // Mock a response with tool call
    const { getProviderClient } = await import("./router/model-router");
    (getProviderClient as any).mockReturnValueOnce({
      chat: vi.fn()
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: null,
              toolCalls: [{ id: "call_1", type: "function", function: { name: "memory.search", arguments: JSON.stringify({ query: "test" }) } }]
            }
          }],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify({ type: "final", content: "Found results!" }) }],
          usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        }),
    });

    const result = await reactor.run("Search for test", {
      userId: "U123",
      teamId: "T123",
      traceId: "tr_test2",
      availableTools: ["memory.search"],
    });

    expect(result.finalAnswer).toBe("Found results!");
    expect(result.toolsUsed).toContain("memory.search");
  });
});
