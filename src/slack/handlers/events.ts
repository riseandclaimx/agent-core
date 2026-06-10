import { App, AllMiddlewareArgs } from "@slack/bolt";
import { agent, AgentContext } from "../../agent/index";
import { logger } from "../../obs/logger";
import { memory } from "../../agent/memory";
import { generateId } from "../../utils/id";

/** Register event handlers */
export function handleEvents(app: App) {
  // App mention
  app.event("app_mention", handleAppMention);

  // Direct messages
  app.event("message", handleMessage);

  // File shared
  app.event("file_shared", handleFileShared);

  // Reaction added
  app.event("reaction_added", handleReactionAdded);

  // Member joined channel
  app.event("member_joined_channel", handleMemberJoined);
}

/** Handle @agent mentions in channels */
async function handleAppMention({ event, client, context, ack }: any) {
  await ack();

  const traceId = context.traceId;
  const log = logger.withTrace(traceId).child({ event: "app_mention" });

  // Remove bot mention from text
  const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!text) {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: "👋 Hi! How can I help you?",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "👋 Hi! How can I help you?" } },
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Help" }, action_id: "help", value: "help" },
            { type: "button", text: { type: "plain_text", text: "Status" }, action_id: "status", value: "status" },
          ],
        },
      ],
    });
    return;
  }

  // Process with agent
  const agentContext: AgentContext = {
    userId: event.user,
    teamId: (event as any).team,
    channelId: event.channel,
    threadTs: event.thread_ts || event.ts,
    traceId,
    slackUser: { id: event.user, name: "", isAdmin: false },
  };

  try {
    const response = await agent.process(text, agentContext);

    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: response.text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: response.text } },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `⚡ ${response.metadata.durationMs}ms • 🔧 ${response.metadata.toolsUsed.length} tools` },
          ],
        },
      ],
    });
  } catch (error) {
    log.error("App mention failed", error as Error);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: `❌ Error: ${(error as Error).message}`,
    });
  }
}

/** Handle direct messages and thread replies */
async function handleMessage({ event, client, context, ack }: any) {
  await ack();

  // Ignore bot messages, subtypes, non-DM non-thread messages
  if (event.subtype || event.bot_id) return;

  const isDM = event.channel_type === "im";
  const isThreadReply = !!event.thread_ts;

  if (!isDM && !isThreadReply) return;

  const traceId = context.traceId;
  const log = logger.withTrace(traceId).child({ event: "message" });

  const text = event.text?.trim();
  if (!text) return;

  const agentContext: AgentContext = {
    userId: event.user,
    teamId: (event as any).team,
    channelId: event.channel,
    threadTs: event.thread_ts || event.ts,
    traceId,
    slackUser: { id: event.user, name: "", isAdmin: false },
  };

  try {
    const response = await agent.process(text, agentContext);

    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: response.text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: response.text } },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `⚡ ${response.metadata.durationMs}ms` },
          ],
        },
      ],
    });
  } catch (error) {
    log.error("Message handling failed", error as Error);
  }
}

/** Handle file uploads */
async function handleFileShared({ event, client, context, ack }: any) {
  await ack();

  const traceId = context.traceId;
  const log = logger.withTrace(traceId).child({ event: "file_shared" });

  try {
    // Get file info
    const fileInfo = await client.files.info({ file: event.file_id });
    const file = fileInfo.file;

    if (!file) return;

    // Download and process file
    // For now, just acknowledge
    await client.chat.postMessage({
      channel: event.channel_id,
      thread_ts: event.thread_ts,
      text: `📎 File received: *${file.name}* (${file.mimetype})`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `📎 File received: *${file.name}* (${file.mimetype})` } },
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Summarize" }, action_id: "file_summarize", value: event.file_id },
            { type: "button", text: { type: "plain_text", text: "Extract Text" }, action_id: "file_extract", value: event.file_id },
            { type: "button", text: { type: "plain_text", text: "Store" }, action_id: "file_store", value: event.file_id },
          ],
        },
      ],
    });
  } catch (error) {
    log.error("File handling failed", error as Error);
  }
}

/** Handle reactions */
async function handleReactionAdded({ event, client, context, ack }: any) {
  await ack();

  // Could trigger workflows based on reactions
  // e.g., ✅ = mark task complete, 🔖 = bookmark, 🐛 = create bug ticket
}

/** Handle member joined */
async function handleMemberJoined({ event, client, context, ack }: any) {
  await ack();

  // Welcome new member
  try {
    await client.chat.postMessage({
      channel: event.channel,
      text: `Welcome <@${event.user}>! 👋`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `Welcome <@${event.user}>! 👋` } },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: "Type `/agent-help` to see what I can do" },
          ],
        },
      ],
    });
  } catch (error) {
    logger.warn("Welcome message failed");
  }
}
