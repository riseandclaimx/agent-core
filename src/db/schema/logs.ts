import { pgTable, uuid, text, timestamp, integer, jsonb, index, boolean } from "drizzle-orm/pg-core";

/** Structured application logs */
export const logs = pgTable(
  "logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    level: text("level", { enum: ["debug", "info", "warn", "error", "fatal"] }).notNull(),
    message: text("message").notNull(),
    service: text("service").notNull().default("agent-core"),
    traceId: text("trace_id"),
    spanId: text("span_id"),
    userId: text("user_id"),
    channelId: text("channel_id"),
    threadTs: text("thread_ts"),
    toolName: text("tool_name"),
    model: text("model"),
    step: integer("step"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    error: jsonb("error").$type<{ message: string; stack?: string; code?: string }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    levelIdx: index("logs_level_idx").on(table.level),
    traceIdx: index("logs_trace_idx").on(table.traceId),
    userIdx: index("logs_user_idx").on(table.userId),
    toolIdx: index("logs_tool_idx").on(table.toolName),
    createdAtIdx: index("logs_created_at_idx").on(table.createdAt),
    serviceLevelIdx: index("logs_service_level_idx").on(table.service, table.level),
  })
);

/** Analytics events for product insights */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventName: text("event_name").notNull(),
    userId: text("user_id"),
    channelId: text("channel_id"),
    threadTs: text("thread_ts"),
    properties: jsonb("properties").$type<Record<string, unknown>>().default({}),
    metrics: jsonb("metrics").$type<Record<string, number>>().default({}),
    traceId: text("trace_id"),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    eventIdx: index("analytics_event_idx").on(table.eventName),
    userIdx: index("analytics_user_idx").on(table.userId),
    createdAtIdx: index("analytics_created_at_idx").on(table.createdAt),
    sessionIdx: index("analytics_session_idx").on(table.sessionId),
  })
);

/** Model usage tracking for cost optimization */
export const modelUsage = pgTable(
  "model_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    model: text("model").notNull(),
    taskType: text("task_type"),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: text("cost_usd"), // Stored as string for precision
    success: boolean("success").default(true),
    error: text("error"),
    userId: text("user_id"),
    traceId: text("trace_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    modelIdx: index("model_usage_model_idx").on(table.model),
    taskTypeIdx: index("model_usage_task_type_idx").on(table.taskType),
    userIdx: index("model_usage_user_idx").on(table.userId),
    createdAtIdx: index("model_usage_created_at_idx").on(table.createdAt),
  })
);

export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type ModelUsage = typeof modelUsage.$inferSelect;