import { Middleware, SlackEventMiddlewareArgs, SlackCommandMiddlewareArgs, SlackActionMiddlewareArgs, SlackViewMiddlewareArgs } from "@slack/bolt";
import { logger } from "../../obs/logger";
import { generateTraceId } from "../../utils/id";
import { getDb } from "../../db/client";
import { users } from "../../db/schema/index";
import { eq } from "drizzle-orm";

export const addContext: Middleware<
  SlackEventMiddlewareArgs | SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs | SlackViewMiddlewareArgs
> = async ({ body, context, next }) => {
  const traceId = (context as any).traceId || generateTraceId();
  const log = logger.withTrace(traceId);
  const anyBody = body as any;
  const userId = anyBody.user_id || anyBody.user?.id || anyBody.event?.user;
  const teamId = anyBody.team_id || anyBody.team?.id || anyBody.event?.team;
  const channelId = anyBody.channel_id || anyBody.channel?.id || anyBody.event?.channel;
  const threadTs = anyBody.thread_ts || anyBody.event?.thread_ts || anyBody.message?.thread_ts;
  let slackUser: { id: string; name: string; isAdmin: boolean } | undefined;
  if (userId) {
    try {
      const db = getDb();
      const user = await db.select().from(users).where(eq(users.slackId, userId)).limit(1).then((r) => r[0]);
      if (user) {
        slackUser = { id: user.slackId, name: user.displayName || user.username || userId, isAdmin: user.isAdmin ?? false };
      }
    } catch (error) {
      log.warn("Failed to fetch user from DB", { err: (error as Error).message });
    }
  }
  (context as any).traceId = traceId;
  (context as any).userId = userId;
  (context as any).teamId = teamId;
  (context as any).channelId = channelId;
  (context as any).threadTs = threadTs;
  (context as any).slackUser = slackUser;
  (context as any).log = log;
  return next();
};
