import { pgTable, uuid, text, timestamp, integer, jsonb, index, boolean } from "drizzle-orm/pg-core";

/** Task queue for async/background work */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["pending", "queued", "running", "completed", "failed", "cancelled"],
    }).notNull().default("pending"),
    priority: integer("priority").default(5), // 1-10
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    retryCount: integer("retry_count").default(0),
    maxRetries: integer("max_retries").default(3),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(), // user_id or "system"
    channelId: text("channel_id"),
    threadTs: text("thread_ts"),
    traceId: text("trace_id"),
    tags: text("tags").array().default([]),
    progress: integer("progress").default(0), // 0-100
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("tasks_status_idx").on(table.status),
    createdByIdx: index("tasks_created_by_idx").on(table.createdBy),
    scheduledIdx: index("tasks_scheduled_idx").on(table.scheduledFor),
    traceIdx: index("tasks_trace_idx").on(table.traceId),
  })
);

/** Task steps for multi-step workflows */
export const taskSteps = pgTable(
  "task_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    name: text("name").notNull(),
    toolName: text("tool_name"),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed", "skipped"],
    }).notNull().default("pending"),
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    taskStepIdx: index("task_steps_task_step_idx").on(table.taskId, table.stepNumber),
  })
);

/** Scheduled/cron tasks */
export const scheduledTasks = pgTable(
  "scheduled_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    cronExpression: text("cron_expression").notNull(),
    taskTemplate: jsonb("task_template").$type<{
      name: string;
      payload: Record<string, unknown>;
      priority?: number;
      tags?: string[];
    }>().notNull(),
    enabled: boolean("enabled").default(true),
    lastRun: timestamp("last_run", { withTimezone: true }),
    nextRun: timestamp("next_run", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskStep = typeof taskSteps.$inferSelect;
export type ScheduledTask = typeof scheduledTasks.$inferSelect;