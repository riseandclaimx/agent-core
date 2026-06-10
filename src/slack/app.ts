import { App, ExpressReceiver } from "@slack/bolt";
import createRequestListener from "@slack/bolt/dist/receivers/ExpressReceiver";
import { logger } from "../obs/logger";
import { generateTraceId } from "../utils/id";
import { agent, AgentContext } from "../agent/index";
import { verifySlackRequest, verifySlackSignature } from "./middleware/auth";
import { addContext } from "./middleware/context";
import { rateLimit } from "./middleware/rate-limit";
import { handleCommands } from "./handlers/commands";
import { handleEvents } from "./handlers/events";
import { handleShortcuts } from "./handlers/shortcuts";
import { handleModals } from "./handlers/modals";
import { handleInteractions } from "./handlers/interactions";

/** Create Bolt app for Cloudflare Workers */
export function createSlackApp(): App {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN; // For Socket Mode

  if (!signingSecret || !botToken) {
    throw new Error("SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN are required");
  }

  const app = new App({
    signingSecret,
    token: botToken,
    // For Workers, we use a custom receiver
    receiver: createWorkerReceiver(),
    // Socket Mode for development (optional)
    ...(appToken && { socketMode: true, appToken }),
  });

  // Middleware
  app.use(verifySlackRequest as any);
  app.use(addContext as any);
  app.use(rateLimit as any);

  // Register handlers
  handleCommands(app);
  handleEvents(app);
  handleShortcuts(app);
  handleModals(app);
  handleInteractions(app);

  // Error handling
  app.error(async (error: any) => { const body = (error as any).body; const boltLogger = (error as any).logger;
    logger.error("Slack app error", error as Error);
  });

  return app;
}

/** Create a Worker-compatible receiver */
function createWorkerReceiver() {
  // This is a simplified receiver for Cloudflare Workers
  // In production, use @slack/bolt with a custom receiver
  return {
    init: async () => {},
    start: async () => {},
    stop: async () => {},
    on: () => {},
  } as any;
}

/** Handle Slack request in Worker */
export async function handleSlackRequest(
  request: Request,
  env: { SLACK_SIGNING_SECRET: string; SLACK_BOT_TOKEN: string }
): Promise<Response> {
  const traceId = generateTraceId();
  const log = logger.withTrace(traceId).child({ component: "slack-handler" });

  try {
    // Verify signature
    const signature = request.headers.get("x-slack-signature");
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const body = await request.text();

    if (!signature || !timestamp) {
      return new Response("Missing Slack headers", { status: 400 });
    }

    if (!verifyRequestSignature(body, timestamp, signature, env.SLACK_SIGNING_SECRET)) {
      log.warn("Invalid Slack signature");
      return new Response("Invalid signature", { status: 401 });
    }

    const payload = JSON.parse(body);

    // Handle URL verification
    if (payload.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: payload.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Process event/command/interaction
    const result = await processPayload(payload, traceId, env.SLACK_BOT_TOKEN);

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    log.error("Slack request failed", error as Error);
    return new Response("Internal error", { status: 500 });
  }
}

/** Verify Slack request signature (Workers-compatible via imported crypto utils) */
function verifyRequestSignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): boolean {
  return verifySlackSignature(body, timestamp, signature, signingSecret);
}

/** Process Slack payload */
async function processPayload(payload: any, traceId: string, botToken: string): Promise<any> {
  const log = logger.withTrace(traceId);

  // Handle different payload types
  switch (payload.type) {
    case "event_callback":
      return handleEventCallback(payload, traceId, botToken);
    case "slash_command":
      return handleSlashCommand(payload, traceId, botToken);
    case "block_actions":
    case "view_submission":
    case "view_closed":
      return handleInteraction(payload, traceId, botToken);
    case "shortcut":
      return handleShortcut(payload, traceId, botToken);
    default:
      log.warn("Unhandled payload type", { type: payload.type });
      return { ok: true };
  }
}

// Placeholder handlers - implemented in handlers/
async function handleEventCallback(payload: any, traceId: string, botToken: string) { return { ok: true }; }
async function handleSlashCommand(payload: any, traceId: string, botToken: string) { return { ok: true }; }
async function handleInteraction(payload: any, traceId: string, botToken: string) { return { ok: true }; }
async function handleShortcut(payload: any, traceId: string, botToken: string) { return { ok: true }; }

export { logger as slackLogger } from "../obs/logger";
