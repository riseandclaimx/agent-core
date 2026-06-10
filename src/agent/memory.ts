import { getDb, withDb } from "../db/client";
import { memories, userMemoryProfiles, conversationContexts } from "../db/schema/index";
import { eq, and, desc, sql, cosineDistance, ilike, or, inArray } from "drizzle-orm";
import { logger } from "../obs/logger";
import { metrics, METRICS } from "../obs/metrics";
import { encrypt, decrypt } from "../utils/crypto";
import { generateId } from "../utils/id";

export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  scope: "global" | "user" | "channel";
  scopeId?: string;
  tags: string[];
  importance: number;
  createdAt: Date;
}

export interface MemorySearchOptions {
  query: string;
  queryEmbedding?: number[];
  scope?: "global" | "user" | "channel";
  scopeId?: string;
  tags?: string[];
  minImportance?: number;
  limit?: number;
  similarityThreshold?: number;
  excludeIds?: string[];
}

export interface MemorySearchResult {
  memory: MemoryEntry;
  score: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.72;
const DEFAULT_LIMIT = 5;
const EMBEDDING_DIMENSIONS = 1536;

/** Memory system for agent - global + user-scoped with pgvector */
export class MemorySystem {
  private get db() {
    return getDb();
  }

  /** Store a new memory */
  async writeMemory(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
    const log = logger.child({ component: "memory", operation: "write" });
    const start = Date.now();

    try {
      const contentHash = await this.hashContent(entry.content);
      const encryptedContent = encrypt(entry.content);

      const [memory] = await this.db
        .insert(memories)
        .values({
          content: encryptedContent,
          contentHash,
          embedding: entry.embedding ?? null,
          metadata: entry.metadata,
          scope: entry.scope,
          scopeId: entry.scopeId,
          tags: entry.tags,
          importance: entry.importance,
        })
        .onConflictDoNothing({ target: memories.contentHash })
        .returning();

      if (!memory) {
        log.debug("Memory already exists (duplicate content)", { contentHash });
        return this.getMemoryByHash(contentHash) as Promise<MemoryEntry>;
      }

      metrics.timing(METRICS.MEMORY_LATENCY_MS, start, { operation: "write" });
      metrics.increment(METRICS.MEMORY_WRITES, { scope: entry.scope });

      log.info("Memory written", { memoryId: memory.id, scope: entry.scope });
      return this.mapMemory(memory);
    } catch (error) {
      log.error("Failed to write memory", error as Error);
      throw error;
    }
  }

  /** Search memories by semantic similarity */
  async searchMemories(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const log = logger.child({ component: "memory", operation: "search" });
    const start = Date.now();

    const {
      query,
      queryEmbedding,
      scope = "global",
      scopeId,
      tags,
      minImportance = 1,
      limit = DEFAULT_LIMIT,
      similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
      excludeIds = [],
    } = options;

    try {
      let embedding: number[] | null = queryEmbedding || null;

      // If no embedding provided, we'd need to generate one
      // For now, require embedding or fall back to keyword search
      if (!embedding) {
        log.warn("No query embedding provided, falling back to keyword search", {});
        return this.keywordSearch(options);
      }

      const embeddingStr = `[${embedding.join(",")}]`;

      const conditions = [
        eq(memories.scope, scope),
        sql`${memories.importance} >= ${minImportance}`,
        sql`1 - (${memories.embedding} <=> ${embeddingStr}::vector) >= ${similarityThreshold}`,
      ];

      if (scopeId) conditions.push(eq(memories.scopeId, scopeId));
      if (tags && tags.length > 0) conditions.push(sql`${memories.tags} && ${tags}`);
      if (excludeIds.length > 0) conditions.push(sql`${memories.id} NOT IN (${excludeIds.join(",")})`);

      const results = await this.db
        .select({
          memory: memories,
          similarity: sql<number>`1 - (${memories.embedding} <=> ${embeddingStr}::vector)`.as("similarity"),
        })
        .from(memories)
        .where(and(...conditions))
        .orderBy(desc(sql`similarity`))
        .limit(limit);

      const mapped = results.map((r) => ({
        memory: this.mapMemory(r.memory),
        score: r.similarity,
      }));

      // Update access count
      if (mapped.length > 0) {
        await this.db
          .update(memories)
          .set({ accessCount: sql`${memories.accessCount} + 1`, lastAccessed: new Date() })
          .where(inArray(memories.id, mapped.map((m) => m.memory.id)));
      }

      metrics.timing(METRICS.MEMORY_LATENCY_MS, start, { operation: "search" });
      metrics.increment(METRICS.MEMORY_QUERIES, { scope });
      metrics.gauge(METRICS.MEMORY_RESULTS, mapped.length, { scope });

      log.info("Memory search completed", { query: query.slice(0, 50), results: mapped.length, scope });
      return mapped;
    } catch (error) {
      log.error("Memory search failed", error as Error);
      return this.keywordSearch(options);
    }
  }

  /** Keyword-based fallback search */
  private async keywordSearch(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const { query, scope = "global", scopeId, tags, minImportance = 1, limit = DEFAULT_LIMIT, excludeIds = [] } = options;
    const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    const conditions = [
      eq(memories.scope, scope),
      sql`${memories.importance} >= ${minImportance}`,
    ];

    if (scopeId) conditions.push(eq(memories.scopeId, scopeId));
    if (tags && tags.length > 0) conditions.push(sql`${memories.tags} && ${tags}`);
    if (excludeIds.length > 0) conditions.push(sql`${memories.id} NOT IN (${excludeIds.join(",")})`);
    if (keywords.length > 0) {
      conditions.push(
        or(...keywords.map((k) => ilike(memories.content, `%${k}%`))) as any
      );
    }

    const results = await this.db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.importance), desc(memories.createdAt))
      .limit(limit);

    return results.map((m) => ({ memory: this.mapMemory(m), score: 0.5 }));
  }

  /** Read a specific memory by ID */
  async readMemory(id: string): Promise<MemoryEntry | null> {
    const [memory] = await this.db.select().from(memories).where(eq(memories.id, id)).limit(1);
    return memory ? this.mapMemory(memory) : null;
  }

  /** Update memory metadata/importance */
  async updateMemory(id: string, updates: Partial<Pick<MemoryEntry, "metadata" | "importance" | "tags">>): Promise<void> {
    await this.db.update(memories).set(updates).where(eq(memories.id, id));
  }

  /** Delete a memory */
  async deleteMemory(id: string): Promise<void> {
    await this.db.delete(memories).where(eq(memories.id, id));
  }

  /** Get or create user memory profile */
  async getUserProfile(userId: string) {
    let [profile] = await this.db.select().from(userMemoryProfiles).where(eq(userMemoryProfiles.userId, userId)).limit(1);
    if (!profile) {
      [profile] = await this.db
        .insert(userMemoryProfiles)
        .values({ userId })
        .returning();
    }
    return profile;
  }

  /** Update user memory profile */
  async updateUserProfile(userId: string, updates: Partial<typeof userMemoryProfiles.$inferInsert>) {
    await this.db
      .insert(userMemoryProfiles)
      .values({ userId, ...updates })
      .onConflictDoUpdate({ target: userMemoryProfiles.userId, set: updates });
  }

  /** Get conversation context for a thread */
  async getConversationContext(channelId: string, threadTs?: string, userId?: string) {
    const conditions = [eq(conversationContexts.channelId, channelId)];
    if (threadTs) conditions.push(eq(conversationContexts.threadTs, threadTs));
    if (userId) conditions.push(eq(conversationContexts.userId, userId));

    const [context] = await this.db
      .select()
      .from(conversationContexts)
      .where(and(...conditions))
      .orderBy(desc(conversationContexts.updatedAt))
      .limit(1);

    return context;
  }

  /** Update conversation context */
  async updateConversationContext(
    channelId: string,
    updates: Partial<typeof conversationContexts.$inferInsert> & { threadTs?: string; userId: string }
  ) {
    const { threadTs, userId, ...rest } = updates;
    await this.db
      .insert(conversationContexts)
      .values({ channelId, threadTs, userId, ...rest })
      .onConflictDoUpdate({
        target: [conversationContexts.channelId, conversationContexts.threadTs, conversationContexts.userId],
        set: { ...rest, updatedAt: new Date() },
      });
  }

  /** Generate embedding for text using configured provider */
  async generateEmbedding(text: string): Promise<number[]> {
    // Try providers in order of preference (free first)
    const providers = [
      { envKey: "GEMINI_API_KEY", fn: this.embedWithGemini.bind(this) },
      { envKey: "OPENAI_API_KEY", fn: this.embedWithOpenAI.bind(this) },
    ];

    for (const { envKey, fn } of providers) {
      if (process.env[envKey]) {
        try {
          return await fn(text);
        } catch (error) {
          logger.warn("Embedding provider failed, trying next", { provider: envKey, error: (error as Error).message });
        }
      }
    }

    // Fallback: deterministic pseudo-embedding (keyword-only, no semantic search)
    logger.warn("No embedding provider configured — falling back to pseudo-embeddings");
    return this.pseudoEmbedding(text);
  }

  /** Gemini embedding (free tier available, 768 dims by default — pad to 1536) */
  private async embedWithGemini(text: string): Promise<number[]> {
    const apiKey = process.env.GEMINI_API_KEY!;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini embedding error (${res.status}): ${await res.text()}`);
    const data: any = await res.json();
    const values: number[] = data.embedding?.values ?? [];
    // Pad or truncate to expected dimensions
    while (values.length < EMBEDDING_DIMENSIONS) values.push(0);
    return values.slice(0, EMBEDDING_DIMENSIONS);
  }

  /** OpenAI embedding (text-embedding-3-small, 1536 dims) */
  private async embedWithOpenAI(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY!;
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI embedding error (${res.status}): ${await res.text()}`);
    const data: any = await res.json();
    return data.data?.[0]?.embedding ?? [];
  }

  /** Deterministic pseudo-embedding fallback (no semantic search) */
  private async pseudoEmbedding(text: string): Promise<number[]> {
    const hash = await this.hashContent(text);
    const embedding = new Array(EMBEDDING_DIMENSIONS).fill(0);
    for (let i = 0; i < hash.length; i += 2) {
      const idx = parseInt(hash.slice(i, i + 2), 16) % EMBEDDING_DIMENSIONS;
      embedding[idx] = (parseInt(hash.slice(i, i + 2), 16) / 255) * 2 - 1;
    }
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map((v) => v / (norm || 1));
  }

  private async hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private mapMemory(row: typeof memories.$inferSelect): MemoryEntry {
    return {
      id: row.id,
      content: decrypt(row.content),
      embedding: row.embedding ?? undefined,
      metadata: row.metadata as Record<string, unknown>,
      scope: row.scope,
      scopeId: row.scopeId || undefined,
      tags: row.tags ?? [],
      importance: row.importance ?? 5,
      createdAt: row.createdAt ?? new Date(),
    };
  }

  private async getMemoryByHash(hash: string): Promise<MemoryEntry> {
    const [memory] = await this.db.select().from(memories).where(eq(memories.contentHash, hash)).limit(1);
    if (!memory) throw new Error("Memory not found");
    return this.mapMemory(memory);
  }
}

export const memory = new MemorySystem();
