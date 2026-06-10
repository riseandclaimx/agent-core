import { App, SlackViewMiddlewareArgs } from "@slack/bolt";
import { logger } from "../../obs/logger";
import { memory } from "../../agent/memory";
import { getDb } from "../../db/client";
import { tasks } from "../../db/schema/index";
import { eq } from "drizzle-orm";

/** Register modal submission handlers */
export function handleModals(app: App) {
  // Task creation modal
  app.view("create_task_modal", handleCreateTaskModal);
  app.view("create_task_from_msg_modal", handleCreateTaskFromMsgModal);

  // Memory search modal
  app.view("search_memory_modal", handleSearchMemoryModal);

  // Generic modal close
  (app as any).viewClosed("*", handleModalClose);
}

/** Handle create task modal submission */
async function handleCreateTaskModal({ ack, view, client, context }: any) {
  await ack();

  const values = view.state.values;
  const name = values.task_name?.name?.value;
  const description = values.task_description?.description?.value || "";
  const priority = parseInt(values.task_priority?.priority?.selected_option?.value || "5");
  const tags = values.task_tags?.tags?.value?.split(",").map((t: string) => t.trim()) || [];

  try {
    const db = getDb();
    const [task] = await db
      .insert(tasks)
      .values({
        name,
        description,
        priority,
        payload: { description, source: "modal" },
        tags,
        createdBy: context.userId,
        channelId: context.channelId,
        threadTs: context.threadTs,
        traceId: context.traceId,
      })
      .returning();

    await client.chat.postMessage({
      channel: context.channelId,
      thread_ts: context.threadTs,
      text: `✅ Task created: *${name}*`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `✅ Task created: *${name}*` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `Priority: ${priority} • ID: \`${task?.id}\`` }] },
      ],
    });
  } catch (error) {
    logger.error("Create task modal failed", error as Error);
    await client.chat.postEphemeral({
      channel: context.channelId,
      user: context.userId,
      text: `❌ Failed to create task: ${(error as Error).message}`,
    });
  }
}

/** Handle create task from message modal */
async function handleCreateTaskFromMsgModal({ ack, view, client, context }: any) {
  await ack();

  const values = view.state.values;
  const name = values.task_name.name.value;
  const description = values.task_description?.description?.value;
  const metadata = JSON.parse(view.private_metadata || "{}");

  try {
    const db = getDb();
    const [task] = await db
      .insert(tasks)
      .values({
        name,
        description,
        priority: 5,
        payload: { description, source: "message", originalMessageTs: metadata.messageTs },
        tags: ["from-message"],
        createdBy: context.userId,
        channelId: metadata.channelId,
        traceId: context.traceId,
      })
      .returning();

    await client.chat.postMessage({
      channel: metadata.channelId,
      thread_ts: metadata.messageTs,
      text: `✅ Task created from message: *${name}*`,
    });
  } catch (error) {
    logger.error("Create task from message failed", error as Error);
  }
}

/** Handle search memory modal */
async function handleSearchMemoryModal({ ack, view, client, context }: any) {
  await ack();

  const values = view.state.values;
  const query = values.search_query?.query?.value || "";
  const scope = values.search_scope?.scope?.selected_option?.value || "global";

  try {
    const scopeId = scope === "user" ? String(context.userId || "") : scope === "channel" ? String(context.channelId || "") : undefined;
    const results = await memory.searchMemories({
      query,
      scope: scope as any,
      scopeId,
      limit: 10,
    });

    if (results.length === 0) {
      await client.chat.postEphemeral({
        channel: context.channelId,
        user: context.userId,
        text: `🔍 No memories found for: *${query}*`,
      });
      return;
    }

    const blocks = [
      { type: "header", text: { type: "plain_text", text: `🔍 ${results.length} memories for "${query}"` } },
      { type: "divider" },
      ...results.map((r, i) => ({
        type: "section",
        text: { type: "mrkdwn", text: `${i + 1}. ${r.memory.content.slice(0, 300)}${r.memory.content.length > 300 ? "..." : ""}\n> Score: ${(r.score * 100).toFixed(1)}%` },
      })),
    ];

    await client.chat.postEphemeral({
      channel: context.channelId,
      user: context.userId,
      blocks,
    });
  } catch (error) {
    logger.error("Search memory modal failed", error as Error);
  }
}

/** Handle modal close */
async function handleModalClose({ view }: any) {
  // Optional: track modal abandonment
  logger.debug("Modal closed", { callbackId: view.callback_id });
}
