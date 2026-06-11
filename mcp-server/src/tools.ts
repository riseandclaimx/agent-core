/**
 * MCP Tool definitions and handlers.
 * Maps agent-core tools to MCP-compatible tool calls with Zod schemas.
 */
import { z } from "zod";
import { getDb } from "./db.js";
import { memories, tasks, users, logs, analyticsEvents, modelUsage } from "./schema.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

type ZodShape = Record<string, z.ZodTypeAny>;

interface ToolDef {
  description: string;
  shape: ZodShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

// ─── Embedding helper ────────────────────────────────────────────────────────

async function generatePseudoEmbedding(text: string): Promise<number[]> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  const dims = 1536;
  const embedding = new Array<number>(dims).fill(0);
  for (let i = 0; i < hashHex.length; i += 2) {
    const idx = parseInt(hashHex.slice(i, i + 2), 16) % dims;
    embedding[idx] = (parseInt(hashHex.slice(i, i + 2), 16) / 255) * 2 - 1;
  }
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (norm > 0) for (let i = 0; i < dims; i++) embedding[i] /= norm;
  return embedding;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text }] } }),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { embedding?: { values?: number[] } };
        if (data.embedding?.values) {
          const v = data.embedding.values;
          while (v.length < 1536) v.push(0);
          return v.slice(0, 1536);
        }
      }
    } catch { /* fallthrough */ }
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: { embedding?: number[] }[] };
        if (data.data?.[0]?.embedding) return data.data[0].embedding;
      }
    } catch { /* fallthrough */ }
  }

  return generatePseudoEmbedding(text);
}

// ─── Encryption (mirrors agent-core) ─────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY required");
  return Buffer.from(key, "base64url");
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

function decrypt(text: string): string {
  const key = getEncryptionKey();
  const [ivStr, encStr, tagStr] = text.split(".");
  if (!ivStr || !encStr || !tagStr) throw new Error("Invalid encrypted format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivStr, "base64url"));
  decipher.setAuthTag(Buffer.from(tagStr, "base64url"));
  return decipher.update(encStr, "base64url", "utf8") + decipher.final("utf8");
}

function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// ─── Scope/Level type helpers ────────────────────────────────────────────────

type Scope = "global" | "user" | "channel";
type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

// ─── Tool Definitions ────────────────────────────────────────────────────────

export function getAllTools(): Record<string, ToolDef> {
  return {
    // ── Memory ────────────────────────────────────────────────────────────
    memory_write: {
      description: "Store a long-term memory with embedding for semantic search",
      shape: {
        content: z.string().describe("Memory content to store"),
        scope: z.enum(["global", "user", "channel"]).default("global").describe("Memory scope"),
        scopeId: z.string().nullish().describe("User/channel ID for scoped memories"),
        tags: z.array(z.string()).default([]).describe("Tags for categorization"),
        importance: z.number().min(1).max(10).default(5).describe("Importance 1-10"),
        metadata: z.record(z.unknown()).default({}).describe("Additional metadata"),
      },
      handler: async (args) => {
        const db = getDb();
        const content = args.content as string;
        const embedding = await generateEmbedding(content);
        const encrypted = encrypt(content);
        const hash = hashContent(content);
        const scope = (args.scope || "global") as Scope;

        const [result] = await db.insert(memories).values({
          content: encrypted,
          contentHash: hash,
          embedding: `[${embedding.join(",")}]`,
          scope,
          scopeId: args.scopeId as string | undefined,
          tags: (args.tags as string[]) || [],
          importance: (args.importance as number) || 5,
          metadata: (args.metadata as Record<string, unknown>) || {},
        }).onConflictDoNothing().returning();

        return result
          ? { id: result.id, scope: result.scope, importance: result.importance, tags: result.tags }
          : { error: "Memory already exists (duplicate content hash)" };
      },
    },

    memory_read: {
      description: "Retrieve a specific memory by ID",
      shape: { id: z.string().describe("Memory ID (UUID)") },
      handler: async (args) => {
        const db = getDb();
        const [mem] = await db.select().from(memories).where(eq(memories.id, args.id as string)).limit(1);
        if (!mem) return { error: "Memory not found" };
        return { ...mem, content: decrypt(mem.content), embedding: undefined };
      },
    },

    memory_search: {
      description: "Semantic search over memories using natural language",
      shape: {
        query: z.string().describe("Search query"),
        scope: z.enum(["global", "user", "channel"]).default("global"),
        scopeId: z.string().nullish().describe("User/channel ID for scoped search"),
        tags: z.array(z.string()).nullish().describe("Filter by tags"),
        minImportance: z.number().min(1).max(10).default(1),
        limit: z.number().min(1).max(20).default(5),
        similarityThreshold: z.number().min(0).max(1).default(0.72),
      },
      handler: async (args) => {
        const db = getDb();
        const embedding = await generateEmbedding(args.query as string);
        const vecStr = `[${embedding.join(",")}]`;
        const limit = (args.limit as number) || 5;
        const threshold = (args.similarityThreshold as number) || 0.72;
        const scope = (args.scope as string) || "global";

        const conditions = [`scope = '${scope}'`];
        if (args.scopeId) conditions.push(`scope_id = '${args.scopeId}'`);
        if (args.minImportance) conditions.push(`importance >= ${args.minImportance}`);

        const results: unknown[] = await db.execute(sql.raw(`
          SELECT id, content, scope, scope_id, tags, importance, metadata, created_at,
                 1 - (embedding <=> '${vecStr}'::vector) as similarity
          FROM memories
          WHERE ${conditions.join(" AND ")}
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> '${vecStr}'::vector) >= ${threshold}
          ORDER BY similarity DESC
          LIMIT ${limit}
        `));

        return (results as any[]).map((r) => ({
          ...r,
          content: r.content ? decrypt(r.content) : null,
          similarity: parseFloat(r.similarity),
        }));
      },
    },

    memory_embed: {
      description: "Generate a vector embedding for text",
      shape: { text: z.string().describe("Text to embed") },
      handler: async (args) => {
        const embedding = await generateEmbedding(args.text as string);
        return { dimensions: embedding.length, preview: embedding.slice(0, 5) };
      },
    },

    // ── Auth ──────────────────────────────────────────────────────────────
    auth_verify_user: {
      description: "Verify a Slack user identity and look up their profile",
      shape: {
        userId: z.string().describe("Slack user ID"),
        teamId: z.string().nullish().describe("Slack team ID"),
      },
      handler: async (args) => {
        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.slackId, args.userId as string)).limit(1);
        return { verified: !!user, user: user || null };
      },
    },

    auth_get_user_roles: {
      description: "Get user roles and permissions",
      shape: { userId: z.string().describe("Slack user ID") },
      handler: async (args) => {
        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.slackId, args.userId as string)).limit(1);
        return { roles: user?.roles || [], permissions: user?.permissions || {} };
      },
    },

    auth_set_user_roles: {
      description: "Set user roles (requires admin context)",
      shape: {
        userId: z.string().describe("Slack user ID"),
        roles: z.array(z.string()).describe("Roles to assign"),
      },
      handler: async (args) => {
        const db = getDb();
        await db.update(users).set({ roles: args.roles as string[], updatedAt: new Date() }).where(eq(users.slackId, args.userId as string));
        return { success: true };
      },
    },

    // ── Tasks ─────────────────────────────────────────────────────────────
    task_enqueue: {
      description: "Create a background task in the task queue",
      shape: {
        name: z.string().describe("Task name"),
        payload: z.record(z.unknown()).describe("Task payload"),
        priority: z.number().min(1).max(10).default(5),
        scheduledFor: z.string().nullish().describe("ISO timestamp to run"),
        maxRetries: z.number().min(0).max(10).default(3),
        tags: z.array(z.string()).default([]),
      },
      handler: async (args) => {
        const db = getDb();
        const [task] = await db.insert(tasks).values({
          name: args.name as string,
          payload: (args.payload as Record<string, unknown>) || {},
          priority: (args.priority as number) || 5,
          scheduledFor: args.scheduledFor ? new Date(args.scheduledFor as string) : undefined,
          maxRetries: (args.maxRetries as number) || 3,
          tags: (args.tags as string[]) || [],
          createdBy: "mcp-client",
          traceId: uuidv4(),
        }).returning();
        return { taskId: task.id, status: task.status, name: task.name };
      },
    },

    task_status: {
      description: "Get the status of a background task",
      shape: { taskId: z.string().describe("Task ID (UUID)") },
      handler: async (args) => {
        const db = getDb();
        const [task] = await db.select().from(tasks).where(eq(tasks.id, args.taskId as string)).limit(1);
        return task || { error: "Task not found" };
      },
    },

    task_cancel: {
      description: "Cancel a pending or running task",
      shape: { taskId: z.string().describe("Task ID (UUID)") },
      handler: async (args) => {
        const db = getDb();
        await db.update(tasks).set({ status: "cancelled", updatedAt: new Date() }).where(eq(tasks.id, args.taskId as string));
        return { cancelled: true, taskId: args.taskId };
      },
    },

    // ── Logging ───────────────────────────────────────────────────────────
    log_write: {
      description: "Write a structured log entry to the database",
      shape: {
        level: z.enum(["debug", "info", "warn", "error", "fatal"]).default("info"),
        message: z.string().describe("Log message"),
        metadata: z.record(z.unknown()).default({}).describe("Additional context"),
      },
      handler: async (args) => {
        const db = getDb();
        const level = (args.level || "info") as LogLevel;
        await db.insert(logs).values({
          level,
          message: args.message as string,
          service: "mcp-server",
          traceId: uuidv4(),
          metadata: (args.metadata as Record<string, unknown>) || {},
        });
        return { logged: true };
      },
    },

    log_search: {
      description: "Search structured logs",
      shape: {
        query: z.string().nullish().describe("Search query (message text)"),
        level: z.enum(["debug", "info", "warn", "error", "fatal"]).nullish(),
        userId: z.string().nullish(),
        traceId: z.string().nullish(),
        since: z.string().nullish().describe("ISO timestamp"),
        limit: z.number().min(1).max(100).default(20),
      },
      handler: async (args) => {
        const db = getDb();
        const conditions = [];
        if (args.query) conditions.push(sql`message ILIKE ${"%" + args.query + "%"}`);
        if (args.level) conditions.push(eq(logs.level, args.level as LogLevel));
        if (args.userId) conditions.push(eq(logs.userId, args.userId as string));
        if (args.traceId) conditions.push(eq(logs.traceId, args.traceId as string));
        if (args.since) conditions.push(sql`${logs.createdAt} >= ${new Date(args.since as string)}`);

        const results = await db.select().from(logs)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(logs.createdAt))
          .limit((args.limit as number) || 20);
        return { count: results.length, logs: results };
      },
    },

    analytics_track_event: {
      description: "Track an analytics event",
      shape: {
        eventName: z.string().describe("Event name"),
        properties: z.record(z.unknown()).default({}),
        metrics: z.record(z.number()).default({}),
      },
      handler: async (args) => {
        const db = getDb();
        await db.insert(analyticsEvents).values({
          eventName: args.eventName as string,
          properties: (args.properties as Record<string, unknown>) || {},
          metrics: (args.metrics as Record<string, number>) || {},
          traceId: uuidv4(),
        });
        return { tracked: true };
      },
    },

    // ── Router ────────────────────────────────────────────────────────────
    router_select_model: {
      description: "Select the optimal AI model for a task based on routing policies",
      shape: {
        taskType: z.string().describe("Task type (e.g. chat, code, analysis)"),
        complexity: z.enum(["low", "medium", "high"]).default("medium"),
        requiresTools: z.boolean().default(false),
        requiresVision: z.boolean().default(false),
      },
      handler: async (args) => {
        const policies: Record<string, { model: string; provider: string; reason: string }> = {
          code: { model: "deepseek:deepseek-chat", provider: "deepseek", reason: "Best for code tasks" },
          vision: { model: "gemini:gemini-2.5-flash-preview-05-20", provider: "gemini", reason: "Vision capable" },
          complex_reasoning: { model: "anthropic:claude-sonnet-4-20250514", provider: "anthropic", reason: "Complex reasoning" },
          chat: { model: "groq:openai/gpt-oss-20b", provider: "groq", reason: "Fast, cost-effective" },
        };
        const key = args.requiresVision ? "vision" : args.complexity === "high" ? "complex_reasoning" :
          (args.taskType as string).includes("code") ? "code" : "chat";
        return policies[key] || policies.chat;
      },
    },

    router_evaluate_cost: {
      description: "Estimate cost of a model call",
      shape: {
        model: z.string().describe("Model key (provider:model)"),
        promptTokens: z.number().describe("Number of prompt tokens"),
        completionTokens: z.number().describe("Number of completion tokens"),
      },
      handler: async (args) => {
        const costs: Record<string, { input: number; output: number }> = {
          "groq:openai/gpt-oss-20b": { input: 0, output: 0 },
          "deepseek:deepseek-chat": { input: 0.14, output: 0.28 },
          "gemini:gemini-2.5-flash-preview-05-20": { input: 0.15, output: 0.60 },
          "openai:gpt-4o-mini": { input: 0.15, output: 0.60 },
          "anthropic:claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
          "cerebras:llama-4-scout-17b-16e-instruct": { input: 0, output: 0 },
        };
        const pricing = costs[args.model as string] || { input: 0.5, output: 1.5 };
        const costUsd = ((args.promptTokens as number) * pricing.input + (args.completionTokens as number) * pricing.output) / 1_000_000;
        return { model: args.model, promptTokens: args.promptTokens, completionTokens: args.completionTokens, estimatedCostUsd: costUsd };
      },
    },

    // ── Model Usage Analytics ─────────────────────────────────────────────
    model_usage_summary: {
      description: "Get model usage statistics and costs",
      shape: {
        since: z.string().nullish().describe("ISO timestamp to start from"),
        model: z.string().nullish().describe("Filter by model"),
        limit: z.number().default(50),
      },
      handler: async (args) => {
        const db = getDb();
        const conditions = [];
        if (args.model) conditions.push(eq(modelUsage.model, args.model as string));
        if (args.since) conditions.push(sql`${modelUsage.createdAt} >= ${new Date(args.since as string)}`);

        const results = await db.select().from(modelUsage)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(modelUsage.createdAt))
          .limit((args.limit as number) || 50);
        return {
          count: results.length,
          totalTokens: results.reduce((s, r) => s + r.totalTokens, 0),
          totalCostUsd: results.reduce((s, r) => s + parseFloat(r.costUsd || "0"), 0),
          usage: results,
        };
      },
    },

    // ── Web ───────────────────────────────────────────────────────────────
    web_fetch: {
      description: "Fetch a URL and return the response",
      shape: {
        url: z.string().url().describe("URL to fetch"),
        headers: z.record(z.string()).nullish().describe("Request headers"),
        timeout: z.number().default(10000),
      },
      handler: async (args) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), (args.timeout as number) || 10000);
        try {
          const res = await fetch(args.url as string, {
            headers: (args.headers as Record<string, string>) || {},
            signal: controller.signal,
          });
          const text = await res.text();
          return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text.slice(0, 10000) };
        } finally {
          clearTimeout(timeout);
        }
      },
    },

    // ── Security ──────────────────────────────────────────────────────────
    security_audit_log: {
      description: "Write an audit log entry for compliance/tracking",
      shape: {
        userId: z.string().describe("User who performed the action"),
        action: z.string().describe("Action performed"),
        resource: z.string().describe("Resource affected"),
        result: z.enum(["success", "failure", "denied"]),
        metadata: z.record(z.unknown()).nullish(),
      },
      handler: async (args) => {
        const db = getDb();
        await db.insert(logs).values({
          level: "info" as const,
          message: `AUDIT: ${args.userId} ${args.action} ${args.resource} -> ${args.result}`,
          service: "mcp-audit",
          userId: args.userId as string,
          metadata: { action: args.action, resource: args.resource, result: args.result, ...(args.metadata as Record<string, unknown> || {}) },
        });
        return { audited: true };
      },
    },

    security_sanitize_input: {
      description: "Sanitize user input to prevent injection attacks",
      shape: {
        input: z.string().describe("Input to sanitize"),
        policy: z.enum(["strict", "moderate", "lenient"]).default("moderate"),
      },
      handler: async (args) => {
        const input = args.input as string;
        const policy = (args.policy as string) || "moderate";
        let sanitized = input;

        if (policy === "strict") {
          sanitized = input.replace(/[<>&"'`\\]/g, "").replace(/\b(DROP|DELETE|INSERT|UPDATE|ALTER|EXEC)\b/gi, "[REDACTED]");
        } else if (policy === "moderate") {
          sanitized = input.replace(/<script[^>]*>.*?<\/script>/gi, "").replace(/[<>]/g, (c) => c === "<" ? "&lt;" : "&gt;");
        }
        return { original_length: input.length, sanitized_length: sanitized.length, sanitized, policy };
      },
    },
  };
}
