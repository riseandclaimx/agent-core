import { Client as QStash } from "@upstash/qstash";
import { Redis } from "@upstash/redis";
import { logger } from "../obs/logger";
import { generateId } from "../utils/id";
import { metrics, METRICS } from "../obs/metrics";

const qstashUrl = process.env.QSTASH_URL || process.env.UPSTASH_REDIS_REST_URL;
const qstashToken = process.env.QSTASH_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!qstashUrl || !qstashToken) {
  logger.warn("Upstash/QStash not configured - async tasks will not work");
}

export const qstash = qstashUrl && qstashToken ? new QStash({ token: qstashToken }) : null;
export const redis = qstashUrl && qstashToken ? new Redis({ url: qstashUrl, token: qstashToken }) : null;

export interface TaskPayload {
  name: string;
  payload: Record<string, unknown>;
  priority?: number;
  maxRetries?: number;
  scheduledFor?: Date;
  tags?: string[];
  traceId?: string;
  userId?: string;
  channelId?: string;
  threadTs?: string;
}

export interface EnqueueResult {
  taskId: string;
  messageId?: string;
}

/** Enqueue a task for async execution */
export async function enqueueTask(payload: TaskPayload): Promise<EnqueueResult> {
  const taskId = generateId("task");
  const log = logger.child({ taskId, component: "queue" });

  if (!qstash) {
    throw new Error("QStash not configured");
  }

  try {
    const body = JSON.stringify({ ...payload, taskId });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Upstash-Forward-Trace": "true",
    };

    let messageId: string | undefined;

    if (payload.scheduledFor) {
      const delaySeconds = Math.max(0, Math.floor((payload.scheduledFor.getTime() - Date.now()) / 1000));
      const res = await qstash.publishJSON({
        url: `${process.env.WORKER_URL}/tasks/execute`,
        body,
        delay: delaySeconds,
        retries: payload.maxRetries ?? 3,
        headers,
      });
      messageId = res.messageId;
    } else {
      const res = await qstash.publishJSON({
        url: `${process.env.WORKER_URL}/tasks/execute`,
        body,
        retries: payload.maxRetries ?? 3,
        headers,
      });
      messageId = res.messageId;
    }

    metrics.increment(METRICS.TASKS_ENQUEUED, { name: payload.name });
    log.info("Task enqueued", { messageId, name: payload.name });

    return { taskId, messageId };
  } catch (error) {
    log.error("Failed to enqueue task", error as Error);
    throw error;
  }
}

/** Cancel a scheduled task */
export async function cancelTask(messageId: string): Promise<boolean> {
  if (!qstash) return false;
  try {
    await qstash.delete(messageId);
    return true;
  } catch {
    return false;
  }
}

/** Get task status from Redis */
export async function getTaskStatus(taskId: string): Promise<{
  status: "pending" | "running" | "completed" | "failed" | "unknown";
  result?: unknown;
  error?: string;
  progress?: number;
} | null> {
  if (!redis) return null;
  try {
    const data = await redis.get(`task:${taskId}`);
    return data as any;
  } catch {
    return null;
  }
}

/** Update task status (called by task executor) */
export async function updateTaskStatus(
  taskId: string,
  status: "running" | "completed" | "failed",
  data?: { result?: unknown; error?: string; progress?: number }
): Promise<void> {
  if (!redis) return;
  try {
    const key = `task:${taskId}`;
    const existing = (await redis.get(key)) as any || {};
    const updated = {
      ...existing,
      status,
      ...data,
      updatedAt: Date.now(),
    };
    await redis.set(key, updated, { ex: 86400 * 7 }); // 7 days TTL
  } catch (error) {
    logger.error("Failed to update task status", error as Error);
  }
}

/** Rate limiting using Redis */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (!redis) return { allowed: true, remaining: limit, resetAt: Date.now() + windowMs };

  const now = Date.now();
  const windowStart = now - windowMs;
  const redisKey = `ratelimit:${key}`;

  try {
    // Remove expired entries
    await redis.zremrangebyscore(redisKey, 0, windowStart);

    // Count current requests
    const count = await redis.zcard(redisKey);

    if (count >= limit) {
      const oldest = await redis.zrange(redisKey, 0, 0, { withScores: true });
      const resetAt = oldest.length > 0 ? (oldest[0] as any)[1] as number + windowMs : now + windowMs;
      return { allowed: false, remaining: 0, resetAt };
    }

    // Add current request
    await redis.zadd(redisKey, { score: now, member: `${now}:${generateId()}` });
    await redis.expire(redisKey, Math.ceil(windowMs / 1000) + 1);

    return { allowed: true, remaining: limit - count - 1, resetAt: now + windowMs };
  } catch (error) {
    logger.error("Rate limit check failed", error as Error);
    return { allowed: true, remaining: limit, resetAt: now + windowMs };
  }
}

/** Distributed lock */
export async function acquireLock(
  key: string,
  ttlMs = 30000
): Promise<{ acquired: boolean; lockId?: string }> {
  if (!redis) return { acquired: true };
  const lockId = generateId("lock");
  const lockKey = `lock:${key}`;
  try {
    const acquired = await redis.set(lockKey, lockId, { nx: true, px: ttlMs });
    return { acquired: acquired === "OK", lockId };
  } catch {
    return { acquired: false };
  }
}

export async function releaseLock(key: string, lockId: string): Promise<boolean> {
  if (!redis) return true;
  const lockKey = `lock:${key}`;
  try {
    // Lua script for safe release
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await (redis as any).eval(script, [lockKey], [lockId]);
    return result === 1;
  } catch {
    return false;
  }
}
