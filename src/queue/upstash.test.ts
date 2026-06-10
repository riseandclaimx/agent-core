import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Upstash
vi.mock("@upstash/qstash", () => ({
  Client: vi.fn().mockImplementation(() => ({
    publishJSON: vi.fn().mockResolvedValue({ messageId: "msg_123" }),
    messages: { delete: vi.fn().mockResolvedValue(true) },
  })),
}));

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
    zadd: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    zrange: vi.fn().mockResolvedValue([]),
    eval: vi.fn().mockResolvedValue(1),
  })),
}));

vi.mock("../obs/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../obs/metrics", () => ({
  metrics: { increment: vi.fn(), timing: vi.fn(), gauge: vi.fn() },
  METRICS: { TASKS_ENQUEUED: "tasks.enqueued", TASKS_COMPLETED: "tasks.completed", TASKS_FAILED: "tasks.failed" },
}));

vi.mock("../utils/id", () => ({
  generateId: (prefix?: string) => `${prefix || "id"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
}));

describe("Upstash Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure env vars are set for lazy init
    process.env.QSTASH_TOKEN = "test-token";
    process.env.QSTASH_URL = "https://test.upstash.io";
    process.env.WORKER_URL = "http://localhost:8788";
  });

  it("enqueueTask returns task ID and message ID", async () => {
    const { enqueueTask } = await import("./upstash");
    const result = await enqueueTask({
      name: "test_task",
      payload: { data: "test" },
      priority: 5,
    });

    expect(result.taskId).toMatch(/^task_/);
    expect(result.messageId).toBe("msg_123");
  });

  it("checkRateLimit allows requests under limit", async () => {
    const { checkRateLimit } = await import("./upstash");
    const result = await checkRateLimit("test_key", 10, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  it("acquireLock and releaseLock work", async () => {
    const { acquireLock, releaseLock } = await import("./upstash");
    const { acquired, lockId } = await acquireLock("test_lock");
    expect(acquired).toBe(true);
    expect(lockId).toBeDefined();

    const released = await releaseLock("test_lock", lockId!);
    expect(released).toBe(true);
  });
});
