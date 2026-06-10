import { describe, it, expect } from "vitest";
import { generateId, generateToken, generateTraceId, generateSpanId } from "./id";

describe("id utilities", () => {
  it("generateId creates ULID with optional prefix", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const prefixed = generateId("task");
    expect(prefixed).toMatch(/^task_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("generateToken creates base64url token", () => {
    const token = generateToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes = 43 base64url chars
  });

  it("generateTraceId creates trace ID", () => {
    const traceId = generateTraceId();
    expect(traceId).toMatch(/^tr_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("generateSpanId creates span ID", () => {
    const spanId = generateSpanId();
    expect(spanId).toMatch(/^sp_[0-9A-HJKMNP-TV-Z]{16}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });
});
