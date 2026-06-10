import { Middleware, SlackEventMiddlewareArgs, SlackCommandMiddlewareArgs } from "@slack/bolt";
import { checkRateLimit } from "../../queue/upstash";
import { logger } from "../../obs/logger";

const COMMAND_LIMIT = 30;
const COMMAND_WINDOW = 60_000;
const EVENT_LIMIT = 100;
const EVENT_WINDOW = 60_000;

export const rateLimit: Middleware<SlackEventMiddlewareArgs | SlackCommandMiddlewareArgs> = async ({
  body,
  context,
  next,
}) => {
  const userId = context?.userId as string | undefined;
  if (!userId) return next();

  const isCommand = "command" in body;
  const limit = isCommand ? COMMAND_LIMIT : EVENT_LIMIT;
  const windowMs = isCommand ? COMMAND_WINDOW : EVENT_WINDOW;

  const key = `rate:${isCommand ? "cmd" : "event"}:${userId}`;
  const result = await checkRateLimit(key, limit, windowMs).catch(() => ({ allowed: true, remaining: limit, resetAt: 0 }));

  if (!result.allowed) {
    logger.warn("Rate limit exceeded", { userId, isCommand });
    return;
  }

  return next();
};
