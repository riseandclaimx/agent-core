import { beforeAll, afterAll, vi } from "vitest";

// Mock Cloudflare Workers globals
globalThis.Response = Response;
globalThis.Request = Request;
globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.FormData = FormData;
globalThis.ReadableStream = ReadableStream;
globalThis.TransformStream = TransformStream;
globalThis.crypto = crypto;

// Mock environment
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.SLACK_SIGNING_SECRET = "test-secret";
process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.UPSTASH_REDIS_REST_URL = "https://test.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
process.env.GROQ_API_KEY = "gsk-test";
process.env.ENCRYPTION_KEY = "dGVzdC1lbmNyeXB0aW9uLWtleS10aGlydHktYnl0ZXM="; // base64 32 bytes
process.env.WORKER_URL = "http://localhost:8788";

// Mock timers
vi.useFakeTimers();

// Cleanup
afterAll(() => {
  vi.useRealTimers();
});