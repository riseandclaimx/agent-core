import { describe, it, expect } from "vitest";
import { modelRouter } from "./model-router";

describe("ModelRouter", () => {
  it("selects default model for simple QA", () => {
    const result = modelRouter.selectModel({
      taskType: "qa",
      complexity: "low",
      requiresTools: false,
      requiresVision: false,
      estimatedContextTokens: 1000,
    });

    expect(result.model).toBeDefined();
    expect(result.provider).toBeDefined();
    expect(result.reason).toContain("Matched rule");
  });

  it("selects tool-capable model for tool use", () => {
    const result = modelRouter.selectModel({
      taskType: "automation",
      complexity: "medium",
      requiresTools: true,
      requiresVision: false,
      estimatedContextTokens: 5000,
    });

    expect(result.model).toBeDefined();
    expect(result.fallbackChain.length).toBeGreaterThan(0);
  });

  it("selects coding model for coding tasks", () => {
    const result = modelRouter.selectModel({
      taskType: "coding",
      complexity: "high",
      requiresTools: false,
      requiresVision: false,
      estimatedContextTokens: 10000,
    });

    expect(result.model).toContain("deepseek");
  });

  it("selects long-context model for large context", () => {
    const result = modelRouter.selectModel({
      taskType: "analysis",
      complexity: "high",
      requiresTools: false,
      requiresVision: false,
      estimatedContextTokens: 100000,
    });

    expect(result.model).toContain("gemini");
  });

  it("selects vision model when required", () => {
    const result = modelRouter.selectModel({
      taskType: "general",
      complexity: "medium",
      requiresTools: false,
      requiresVision: true,
      estimatedContextTokens: 5000,
    });

    expect(result.model).toContain("gpt-4o");
  });

  it("estimates cost correctly", () => {
    const cost = modelRouter.estimateCost("groq:openai/gpt-oss-20b", 1000, 500);
    expect(cost).toBe(0); // Free tier

    const cost2 = modelRouter.estimateCost("openai:gpt-4o-mini", 1000000, 500000);
    expect(cost2).toBeCloseTo(0.15 * 1 + 0.6 * 0.5, 4); // $0.15/M in + $0.6/M out
  });

  it("gets all models", () => {
    const models = modelRouter.getAllModels();
    expect(Object.keys(models).length).toBeGreaterThan(5);
    expect(models["groq:openai/gpt-oss-20b"]).toBeDefined();
  });
});
