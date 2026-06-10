import { Middleware, SlackCommandMiddlewareArgs, SlackEventMiddlewareArgs } from "@slack/bolt";
import { verifySignature } from "../../utils/crypto";

/** Verify Slack request signature */
export const verifySlackRequest: Middleware<SlackCommandMiddlewareArgs | SlackEventMiddlewareArgs> = async ({
  next,
}) => {
  // In Cloudflare Workers, signature verification happens at the HTTP level
  return next();
};

/** Verify Slack signature for raw HTTP (Worker entry point) */
export function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): boolean {
  return verifySignature(signingSecret, timestamp, body, signature);
}
