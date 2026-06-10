import { describe, it, expect, vi, beforeEach } from "vitest";
import { memory } from "./memory";

// Mock database
vi.mock("../db/client", () => ({
  getDb: () => ({
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: "test-id", content: "encrypted:Test memory", contentHash: "hash", metadata: {}, scope: "global", scopeId: null, tags: ["test"], importance: 7, createdAt: new Date() }]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  }),
  withDb: vi.fn((_, fn) => fn({})),
}));

// Mock crypto
vi.mock("../utils/crypto", () => ({
  encrypt: (text: string) => `encrypted:${text}`,
  decrypt: (text: string) => text.replace("encrypted:", ""),
}));

// Mock logger
vi.mock("../obs/logger", () => {
  const logMethods = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: {
      ...logMethods,
      child: () => ({ ...logMethods, child: () => logMethods }),
      withTrace: () => ({ ...logMethods, child: () => logMethods }),
      withTool: () => logMethods,
      withStep: () => logMethods,
    },
    createRequestLogger: () => logMethods,
  };
});

// Mock metrics
vi.mock("../obs/metrics", () => ({
  metrics: { timing: vi.fn(), increment: vi.fn(), gauge: vi.fn() },
  METRICS: { MEMORY_LATENCY_MS: "memory.latency", MEMORY_WRITES: "memory.writes", MEMORY_QUERIES: "memory.queries", MEMORY_RESULTS: "memory.results" },
}));

describe("MemorySystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writeMemory stores memory with embedding", async () => {
    const result = await memory.writeMemory({
      content: "Test memory",
      embedding: new Array(1536).fill(0.1),
      scope: "global",
      tags: ["test"],
      importance: 7,
    });

    expect(result).toBeDefined();
    expect(result.content).toBe("Test memory");
    expect(result.importance).toBe(7);
    expect(result.tags).toEqual(["test"]);
  });

  it("generateEmbedding produces normalized vector", async () => {
    const embedding = await memory.generateEmbedding("test text");
    expect(embedding).toHaveLength(1536);
    // Check normalization
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("searchMemories returns results with scores", async () => {
    const results = await memory.searchMemories({
      query: "test",
      queryEmbedding: new Array(1536).fill(0.1),
      limit: 5,
    });

    expect(Array.isArray(results)).toBe(true);
  });
});
