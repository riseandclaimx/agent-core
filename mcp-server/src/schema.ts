/**
 * Database schema — mirrors the agent-core schema exactly.
 * Duplicated here so the MCP server is a standalone deployable.
 */
import {
  pgTable, uuid, text, timestamp, integer, jsonb, index, boolean,
} from "drizzle-orm/pg-core";

// pgvector not available in standalone drizzle — use raw SQL for vector ops
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull().unique(),
    embedding: text("embedding"), // stored as text, vector ops via raw SQL
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    scope: text("scope", { enum: ["global", "user", "channel"] }).notNull().default("global"),
    scopeId: text("scope_id"),
    tags: text("tags").array().default([]),
    importance: integer("importance").default(5),
    accessCount: integer("access_count").default(0),
    lastAccessed: timestamp("last_accessed", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    scopeIdx: index("memories_scope_idx").on(table.scope, table.scopeId),
    importanceIdx: index("memories_importance_idx").on(table.importance),
    createdAtIdx: index("memories_created_at_idx").on(table.createdAt),
  })
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["pending", "queued", "running", "completed", "failed", "cancelled"],
    }).notNull().default("pending"),
    priority: integer("priority").default(5),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    retryCount: integer("retry_count").default(0),
    maxRetries: integer("max_retries").default(3),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    channelId: text("channel_id"),
    threadTs: text("thread_ts"),
    traceId: text("trace_id"),
    tags: text("tags").array().default([]),
    progress: integer("progress").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("tasks_status_idx").on(table.status),
    createdByIdx: index("tasks_created_by_idx").on(table.createdBy),
  })
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slackId: text("slack_id").notNull().unique(),
    slackTeamId: text("slack_team_id").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    realName: text("real_name"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    isBot: boolean("is_bot").default(false),
    isAdmin: boolean("is_admin").default(false),
    isOwner: boolean("is_owner").default(false),
    roles: text("roles").array().default([]),
    permissions: jsonb("permissions").$type<Record<string, boolean>>().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    lastActive: timestamp("last_active", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    slackIdIdx: index("users_slack_id_idx").on(table.slackId),
  })
);

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
    createdAtIdx: index("logs_created_at_idx").on(table.createdAt),
  })
);

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
  })
);

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
    costUsd: text("cost_usd"),
    success: boolean("success").default(true),
    error: text("error"),
    userId: text("user_id"),
    traceId: text("trace_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    modelIdx: index("model_usage_model_idx").on(table.model),
  })
);
