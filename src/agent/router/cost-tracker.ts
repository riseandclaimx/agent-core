import { getRedis } from "../../queue/upstash";
import { logger } from "../../obs/logger";
import { metrics, METRICS } from "../../obs/metrics";

interface CostRecord {
  userId: string;
  teamId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: number;
  traceId?: string;
}

const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const USER_DAILY_LIMIT = 5.00;
const TEAM_DAILY_LIMIT = 50.00;
const REQUEST_LIMIT = 0.50;

export class CostTracker {
  private userLimits: Map<string, number> = new Map();
  private teamLimits: Map<string, number> = new Map();

  async recordUsage(record: CostRecord): Promise<{ allowed: boolean; remaining: { user: number; team: number } }> {
    const redis = getRedis();
    const { userId, teamId, costUsd } = record;
    const now = Date.now();
    const dayStart = now - (now % DAILY_WINDOW_MS);
    const dayKey = Math.floor(dayStart / DAILY_WINDOW_MS).toString();

    if (redis) {
      try {
        const recordKey = `usage:${teamId}:${userId}:${dayKey}:${record.traceId || generateId()}`;
        await redis.set(recordKey, record, { ex: 86400 * 30 });
      } catch {
        logger.warn("Failed to store usage record");
      }
    }

    const userDailyKey = `cost:user:${userId}:${dayKey}`;
    const teamDailyKey = `cost:team:${teamId}:${dayKey}`;
    let userSpent = 0;
    let teamSpent = 0;

    if (redis) {
      try {
        const [userVal, teamVal] = await Promise.all([
          redis.incrbyfloat(userDailyKey, costUsd),
          redis.incrbyfloat(teamDailyKey, costUsd),
        ]);
        userSpent = userVal;
        teamSpent = teamVal;
        await Promise.all([
          redis.expire(userDailyKey, 86400 * 2),
          redis.expire(teamDailyKey, 86400 * 2),
        ]);
      } catch {
        logger.warn("Failed to update cost counters");
      }
    }

    const userRemaining = Math.max(0, USER_DAILY_LIMIT - userSpent);
    const teamRemaining = Math.max(0, TEAM_DAILY_LIMIT - teamSpent);
    const allowed = userSpent <= USER_DAILY_LIMIT && teamSpent <= TEAM_DAILY_LIMIT;

    if (!allowed) {
      logger.warn("Cost limit exceeded");
    }

    metrics.gauge(METRICS.AGENT_COST_USD, costUsd, { userId, teamId });
    metrics.gauge("cost.user_daily_spent", userSpent, { userId });
    metrics.gauge("cost.team_daily_spent", teamSpent, { teamId });

    return { allowed, remaining: { user: userRemaining, team: teamRemaining } };
  }

  async checkLimits(userId: string, teamId: string, estimatedCost: number): Promise<{
    allowed: boolean;
    reason?: string;
    remaining: { user: number; team: number };
  }> {
    if (estimatedCost > REQUEST_LIMIT) {
      return {
        allowed: false,
        reason: `Request cost $${estimatedCost.toFixed(4)} exceeds per-request limit $${REQUEST_LIMIT}`,
        remaining: { user: USER_DAILY_LIMIT, team: TEAM_DAILY_LIMIT },
      };
    }

    const redis = getRedis();
    const now = Date.now();
    const dayStart = now - (now % DAILY_WINDOW_MS);
    const dayKey = Math.floor(dayStart / DAILY_WINDOW_MS).toString();

    const userDailyKey = `cost:user:${userId}:${dayKey}`;
    const teamDailyKey = `cost:team:${teamId}:${dayKey}`;
    let userSpent = 0;
    let teamSpent = 0;

    if (redis) {
      try {
        const [userVal, teamVal] = await Promise.all([
          redis.get(userDailyKey),
          redis.get(teamDailyKey),
        ]);
        userSpent = parseFloat(userVal as string) || 0;
        teamSpent = parseFloat(teamVal as string) || 0;
      } catch {
        // Allow request on error
      }
    }

    const userRemaining = Math.max(0, USER_DAILY_LIMIT - userSpent);
    const teamRemaining = Math.max(0, TEAM_DAILY_LIMIT - teamSpent);
    const allowed = (userSpent + estimatedCost) <= USER_DAILY_LIMIT && (teamSpent + estimatedCost) <= TEAM_DAILY_LIMIT;

    return { allowed, reason: allowed ? undefined : "Daily cost limit would be exceeded", remaining: { user: userRemaining, team: teamRemaining } };
  }

  async getSpending(userId: string, teamId: string): Promise<{
    userDaily: number;
    teamDaily: number;
    userRemaining: number;
    teamRemaining: number;
  }> {
    const redis = getRedis();
    const now = Date.now();
    const dayStart = now - (now % DAILY_WINDOW_MS);
    const dayKey = Math.floor(dayStart / DAILY_WINDOW_MS).toString();

    const userDailyKey = `cost:user:${userId}:${dayKey}`;
    const teamDailyKey = `cost:team:${teamId}:${dayKey}`;
    let userSpent = 0;
    let teamSpent = 0;

    if (redis) {
      try {
        const [userVal, teamVal] = await Promise.all([
          redis.get(userDailyKey),
          redis.get(teamDailyKey),
        ]);
        userSpent = parseFloat(userVal as string) || 0;
        teamSpent = parseFloat(teamVal as string) || 0;
      } catch {
        // Ignore
      }
    }

    return {
      userDaily: userSpent,
      teamDaily: teamSpent,
      userRemaining: Math.max(0, USER_DAILY_LIMIT - userSpent),
      teamRemaining: Math.max(0, TEAM_DAILY_LIMIT - teamSpent),
    };
  }

  async setCustomLimit(userId: string, limit: number): Promise<void> {
    this.userLimits.set(userId, limit);
    const redis = getRedis();
    if (redis) {
      await redis.set(`cost:limit:user:${userId}`, limit.toString());
    }
  }

  async setTeamLimit(teamId: string, limit: number): Promise<void> {
    this.teamLimits.set(teamId, limit);
    const redis = getRedis();
    if (redis) {
      await redis.set(`cost:limit:team:${teamId}`, limit.toString());
    }
  }
}

export const costTracker = new CostTracker();

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
