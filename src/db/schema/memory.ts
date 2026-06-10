import { pgTable, uuid, text, timestamp, integer, jsonb, index, vector } from "drizzle-orm/pg-core";

/** Global memories (shared knowledge base) */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull().unique(),
    embedding: vector("embedding", { dimensions: 1536 }), // OpenAI/Cohere compatible
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    scope: text("scope", { enum: ["global", "user", "channel"] }).notNull().default("global"),
    scopeId: text("scope_id"), // user_id or channel_id when scope != global
    tags: text("tags").array().default([]),
    importance: integer("importance").default(5), // 1-10
    accessCount: integer("access_count").default(0),
    lastAccessed: timestamp("last_accessed", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    scopeIdx: index("memories_scope_idx").on(table.scope, table.scopeId),
    tagsIdx: index("memories_tags_idx").on(table.tags),
    importanceIdx: index("memories_importance_idx").on(table.importance),
    createdAtIdx: index("memories_created_at_idx").on(table.createdAt),
    embeddingIdx: index("memories_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  })
);

/** User-specific memory preferences and summaries */
export const userMemoryProfiles = pgTable(
  "user_memory_profiles",
  {
    userId: text("user_id").primaryKey(),
    preferences: jsonb("preferences").$type<{
      topics?: string[];
      language?: string;
      detailLevel?: "brief" | "normal" | "detailed";
    }>().default({}),
    summary: text("summary"), // Auto-generated user summary
    totalMemories: integer("total_memories").default(0),
    lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow(),
  }
);

/** Conversation context for thread continuity */
export const conversationContexts = pgTable(
  "conversation_contexts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts"), // null for channel-level
    userId: text("user_id").notNull(),
    summary: text("summary"), // Rolling summary of conversation
    keyPoints: text("key_points").array().default([]),
    activeTopics: text("active_topics").array().default([]),
    messageCount: integer("message_count").default(0),
    tokenEstimate: integer("token_estimate").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    channelThreadIdx: index("conv_ctx_channel_thread_idx").on(table.channelId, table.threadTs),
    userIdx: index("conv_ctx_user_idx").on(table.userId),
  })
);

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type UserMemoryProfile = typeof userMemoryProfiles.$inferSelect;
export type ConversationContext = typeof conversationContexts.$inferSelect;