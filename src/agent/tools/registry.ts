import { toolDefinitions, ToolName, getToolSchema, getAllToolSchemas } from "./definitions";
import { logger } from "../../obs/logger";
import { metrics, METRICS } from "../../obs/metrics";
import { memory } from "../memory";
import { modelRouter, costTracker } from "../router/index";
import { enqueueTask, getTaskStatus, checkRateLimit } from "../../queue/upstash";
import { getDb } from "../../db/client";
import { logs, analyticsEvents, modelUsage } from "../../db/schema/index";
import { eq, desc } from "drizzle-orm";
import { generateId } from "../../utils/id";

type ToolHandler = (args: unknown, context: ToolContext) => Promise<unknown>;

export interface ToolContext {
  userId: string;
  teamId: string;
  channelId?: string;
  threadTs?: string;
  traceId: string;
  step: number;
  metadata: Record<string, unknown>;
}

interface ToolRegistration {
  name: ToolName;
  handler: ToolHandler;
  description: string;
  parameters: unknown;
  namespace: string;
}

class ToolRegistry {
  private tools = new Map<ToolName, ToolRegistration>();

  constructor() {
    this.registerBuiltins();
  }

  /** Register a tool */
  register(name: ToolName, handler: ToolHandler, description?: string): void {
    const def = toolDefinitions[name];
    if (!def) throw new Error(`Unknown tool: ${name}`);

    const namespace = name.split(".")[0];
    this.tools.set(name, {
      name,
      handler,
      description: description || def.description,
      parameters: def.parameters,
      namespace: namespace!,
    });
  }

  /** Get a tool registration */
  get(name: ToolName): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  /** Get all tools */
  getAll(): ToolRegistration[] {
    return [...this.tools.values()];
  }

  /** Get tools by namespace */
  getByNamespace(namespace: string): ToolRegistration[] {
    return this.getAll().filter((t) => t.namespace === namespace);
  }

  /** Get OpenAI function schemas for all registered tools */
  getFunctionSchemas() {
    return this.getAll().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /** Execute a tool */
  async execute(name: ToolName, args: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    const log = logger.withTool(name).withTrace(context.traceId).withStep(context.step);
    const start = Date.now();

    try {
      // Validate args against schema
      const def = toolDefinitions[name];
      const parsed = def.parameters.parse(args);

      log.info("Tool invoked", { args: parsed });

      const result = await tool.handler(parsed, context);

      metrics.timing(METRICS.TOOL_LATENCY_MS, start, { tool: name });
      metrics.increment(METRICS.TOOL_CALLS, { tool: name, status: "success" });

      log.info("Tool completed", { result: typeof result });
      return result;
    } catch (error) {
      metrics.increment(METRICS.TOOL_ERRORS, { tool: name, error: (error as Error).name });
      log.error("Tool failed", error as Error);
      throw error;
    }
  }

  /** Register built-in tools */
  private registerBuiltins(): void {
    // Memory tools
    this.register("memory.write", async (args, ctx) => {
      const { content, scope, scopeId, tags, importance, metadata } = args as {
        content: string;
        scope: "global" | "user" | "channel";
        scopeId?: string;
        tags?: string[];
        importance?: number;
        metadata?: Record<string, unknown>;
      };
      const finalScopeId = scopeId || (scope === "user" ? ctx.userId : scope === "channel" ? ctx.channelId : undefined);
      const embedding = await memory.generateEmbedding(content);
      return memory.writeMemory({
        content,
        embedding,
        scope,
        scopeId: finalScopeId,
        tags: tags || [],
        importance: importance || 5,
        metadata: { ...metadata, traceId: ctx.traceId, step: ctx.step },
      });
    });

    this.register("memory.read", async (args) => {
      const { id } = args as { id: string };
      return memory.readMemory(id);
    });

    this.register("memory.search", async (args, ctx) => {
      const { query, scope, scopeId, tags, minImportance, limit, similarityThreshold } = args as {
        query: string;
        scope?: "global" | "user" | "channel";
        scopeId?: string;
        tags?: string[];
        minImportance?: number;
        limit?: number;
        similarityThreshold?: number;
      };
      const finalScopeId = scopeId || (scope === "user" ? ctx.userId : scope === "channel" ? ctx.channelId : undefined);
      const embedding = await memory.generateEmbedding(query);
      return memory.searchMemories({
        query,
        queryEmbedding: embedding,
        scope: scope || "global",
        scopeId: finalScopeId,
        tags,
        minImportance,
        limit,
        similarityThreshold,
      });
    });

    this.register("memory.embed", async (args) => {
      const { text } = args as { text: string };
      return { embedding: await memory.generateEmbedding(text) };
    });

    // Auth tools
    this.register("auth.verify_user", async (args) => {
      const { userId, teamId } = args as { userId: string; teamId?: string };
      const db = getDb();
      const [user] = await db
        .select()
        .from((await import("../../db/schema/index")).users)
        .where(eq((await import("../../db/schema/index")).users.slackId, userId))
        .limit(1);
      return { verified: !!user, user: user || null };
    });

    this.register("auth.get_user_roles", async (args) => {
      const { userId } = args as { userId: string };
      const db = getDb();
      const [user] = await db
        .select()
        .from((await import("../../db/schema/index")).users)
        .where(eq((await import("../../db/schema/index")).users.slackId, userId))
        .limit(1);
      return { roles: user?.roles || [], permissions: user?.permissions || {} };
    });

    this.register("auth.set_user_roles", async (args, ctx) => {
      const { userId, roles } = args as { userId: string; roles: string[] };
      // Check admin permission
      const db = getDb();
      const [requester] = await db
        .select()
        .from((await import("../../db/schema/index")).users)
        .where(eq((await import("../../db/schema/index")).users.slackId, ctx.userId))
        .limit(1);
      if (!requester?.roles?.includes("admin")) {
        throw new Error("Insufficient permissions");
      }
      await db
        .update((await import("../../db/schema/index")).users)
        .set({ roles, updatedAt: new Date() })
        .where(eq((await import("../../db/schema/index")).users.slackId, userId));
      return { success: true };
    });

    // Task tools
    this.register("task.enqueue", async (args, ctx) => {
      const { name, payload, priority, scheduledFor, maxRetries, tags } = args as {
        name: string;
        payload: Record<string, unknown>;
        priority?: number;
        scheduledFor?: string;
        maxRetries?: number;
        tags?: string[];
      };
      const result = await enqueueTask({
        name,
        payload: { ...payload, traceId: ctx.traceId, userId: ctx.userId },
        priority,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
        maxRetries,
        tags: [...(tags || []), `trace:${ctx.traceId}`],
        traceId: ctx.traceId,
        userId: ctx.userId,
        channelId: ctx.channelId,
        threadTs: ctx.threadTs,
      });
      return result;
    });

    this.register("task.status", async (args) => {
      const { taskId } = args as { taskId: string };
      const status = await getTaskStatus(taskId);
      if (!status) {
        // Fallback to DB
        const db = getDb();
        const [task] = await db
          .select()
          .from((await import("../../db/schema/index")).tasks)
          .where(eq((await import("../../db/schema/index")).tasks.id, taskId))
          .limit(1);
        return task || { status: "unknown" };
      }
      return status;
    });

    this.register("task.cancel", async (args) => {
      const { taskId } = args as { taskId: string };
      // Would need messageId from task record
      return { cancelled: true, taskId };
    });

    // Logging tools
    this.register("log.write", async (args, ctx) => {
      const { level, message, metadata } = args as {
        level: "debug" | "info" | "warn" | "error" | "fatal";
        message: string;
        metadata?: Record<string, unknown>;
      };
      const db = getDb();
      await db.insert(logs).values({
        level,
        message,
        service: "agent-core",
        traceId: ctx.traceId,
        userId: ctx.userId,
        channelId: ctx.channelId,
        threadTs: ctx.threadTs,
        metadata: { ...metadata, step: ctx.step },
      });
      return { logged: true };
    });

    this.register("log.search", async (args) => {
      const { query, level, toolName, userId, traceId, since, limit } = args as {
        query?: string;
        level?: "debug" | "info" | "warn" | "error" | "fatal";
        toolName?: string;
        userId?: string;
        traceId?: string;
        since?: string;
        limit?: number;
      };
      const db = getDb();
      const conditions = [];
      if (query) conditions.push(sql`message ILIKE ${"%" + query + "%"}`);
      if (level) conditions.push(eq(logs.level, level));
      if (toolName) conditions.push(eq(logs.toolName, toolName));
      if (userId) conditions.push(eq(logs.userId, userId));
      if (traceId) conditions.push(eq(logs.traceId, traceId));
      if (since) conditions.push(sql`${logs.createdAt} >= ${new Date(since)}`);

      const results = await db
        .select()
        .from(logs)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(logs.createdAt))
        .limit(limit || 20);
      return { logs: results };
    });

    this.register("analytics.track_event", async (args, ctx) => {
      const { eventName, properties, metrics: eventMetrics } = args as {
        eventName: string;
        properties?: Record<string, unknown>;
        metrics?: Record<string, number>;
      };
      const db = getDb();
      await db.insert(analyticsEvents).values({
        eventName,
        userId: ctx.userId,
        channelId: ctx.channelId,
        threadTs: ctx.threadTs,
        traceId: ctx.traceId,
        properties: properties || {},
        metrics: eventMetrics || {},
      });
      return { tracked: true };
    });

    // Routing tools
    this.register("router.select_model", async (args) => {
      const { taskType, complexity, requiresTools, requiresVision, estimatedContextTokens, preferredModel } = args as {
        taskType: string;
        complexity?: "low" | "medium" | "high";
        requiresTools?: boolean;
        requiresVision?: boolean;
        estimatedContextTokens?: number;
        preferredModel?: string;
      };
      const result = modelRouter.selectModel({
        taskType,
        complexity: complexity || "medium",
        requiresTools: requiresTools || false,
        requiresVision: requiresVision || false,
        estimatedContextTokens: estimatedContextTokens || 0,
        preferredModel,
      });
      return result;
    });

    this.register("router.select_tool", async (args) => {
      const { task, availableTools } = args as { task: string; availableTools: string[] };
      // Simple heuristic - in production, use embedding similarity
      const keywords = task.toLowerCase().split(/\s+/);
      const scored = availableTools.map((t) => {
        const toolKeywords = t.split(".").flatMap((p) => p.split("_"));
        const score = keywords.filter((k) => toolKeywords.some((tk) => tk.includes(k) || k.includes(tk))).length;
        return { tool: t, score };
      });
      scored.sort((a, b) => b.score - a.score);
      return { recommended: scored[0]?.tool, alternatives: scored.slice(1, 4).map((s) => s.tool) };
    });

    this.register("router.evaluate_cost", async (args) => {
      const { model, promptTokens, completionTokens, toolCalls } = args as {
        model: string;
        promptTokens: number;
        completionTokens: number;
        toolCalls?: number;
      };
      const cost = modelRouter.estimateCost(model, promptTokens, completionTokens);
      return { model, promptTokens, completionTokens, toolCalls: toolCalls || 0, estimatedCostUsd: cost };
    });

    // Placeholder handlers for external integrations
    const externalTools = [
      "email.send",
      "email.get_status",
      "sms.send",
      "sms.verify_code",
      "storage.upload",
      "storage.download",
      "storage.list",
      "web.fetch",
      "web.scrape",
      "business.calculate_commission",
      "business.generate_invoice_data",
      "business.assign_lead",
      "security.sanitize_input",
      "security.check_permissions",
      "security.audit_log",
    ];

    for (const name of externalTools) {
      this.register(name as any, async () => {
        return { error: `Tool ${name} not implemented - requires external service integration` };
      });
    }
  }
}

export const toolRegistry = new ToolRegistry();
