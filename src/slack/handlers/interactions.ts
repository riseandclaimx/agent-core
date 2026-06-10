import { App, SlackActionMiddlewareArgs } from "@slack/bolt";
import { logger } from "../../obs/logger";
import { getDb } from "../../db/client";
import { tasks } from "../../db/schema/index";
import { eq } from "drizzle-orm";

/** Register block action handlers */
export function handleInteractions(app: App) {
  // Task actions
  app.action("task_run", handleTaskRun);
  app.action("task_view", handleTaskView);
  app.action("task_cancel", handleTaskCancel);

  // File actions
  app.action("file_summarize", handleFileSummarize);
  app.action("file_extract", handleFileExtract);
  app.action("file_store", handleFileStore);

  // Help actions
  app.action("help", handleHelpAction);
  app.action("status", handleStatusAction);

  // Generic action handler
  app.action(/.*/, handleGenericAction);
}

/** Run a task */
async function handleTaskRun({ ack, action, client, context }: any) {
  await ack();

  const taskId = action.value;
  if (!taskId) return;

  try {
    const db = getDb();
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      await client.chat.postEphemeral({
        channel: context.channelId,
        user: context.userId,
        text: "Task not found",
      });
      return;
    }

    // Update status to running
    await db.update(tasks).set({ status: "running", startedAt: new Date() }).where(eq(tasks.id, taskId));

    // In production, enqueue for actual execution
    await client.chat.postMessage({
      channel: context.channelId,
      thread_ts: context.threadTs,
      text: `▶️ Task started: *${task.name}*`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `▶️ Task started: *${task.name}*` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `ID: \`${taskId}\`` }] },
      ],
    });
  } catch (error) {
    logger.error("Task run failed", error as Error);
  }
}

/** View task details */
async function handleTaskView({ ack, action, client, context }: any) {
  await ack();

  const taskId = action.value;
  if (!taskId) return;

  try {
    const db = getDb();
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      await client.chat.postEphemeral({
        channel: context.channelId,
        user: context.userId,
        text: "Task not found",
      });
      return;
    }

    const blocks: any[] = [
      { type: "section", text: { type: "mrkdwn", text: `*${task.name}*\n\`${task.id}\`` } },
      { type: "divider" },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Status:* ${task.status}` },
        { type: "mrkdwn", text: `*Priority:* ${task.priority}` },
        { type: "mrkdwn", text: `*Created:* ${task.createdAt?.toLocaleString() || "unknown"}` },
        { type: "mrkdwn", text: `*Progress:* ${task.progress}%` },
      ]},
      { type: "section", text: { type: "mrkdwn", text: `*Description:*\n${task.description || "None"}` } },
    ];

    if (task.result) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Result:*\n${JSON.stringify(task.result, null, 2).slice(0, 1000)}` } });
    }
    if (task.error) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Error:*\n${task.error}` } });
    }

    await client.views.open({
      trigger_id: context.triggerId || "",
      view: {
        type: "modal",
        callback_id: "task_detail_modal",
        title: { type: "plain_text", text: "Task Details" },
        close: { type: "plain_text", text: "Close" },
        blocks,
      },
    });
  } catch (error) {
    logger.error("Task view failed", error as Error);
  }
}

/** Cancel a task */
async function handleTaskCancel({ ack, action, client, context }: any) {
  await ack();

  const taskId = action.value;
  if (!taskId) return;

  try {
    const db = getDb();
    await db.update(tasks).set({ status: "cancelled", updatedAt: new Date() }).where(eq(tasks.id, taskId));

    await client.chat.postMessage({
      channel: context.channelId,
      thread_ts: context.threadTs,
      text: `🚫 Task cancelled: \`${taskId}\``,
    });
  } catch (error) {
    logger.error("Task cancel failed", error as Error);
  }
}

/** Summarize file */
async function handleFileSummarize({ ack, action, client, context }: any) {
  await ack();

  const fileId = action.value;
  await client.chat.postMessage({
    channel: context.channelId,
    thread_ts: context.threadTs,
    text: `📝 Summarizing file ${fileId}...`,
  });
  // Would call agent with file content
}

/** Extract text from file */
async function handleFileExtract({ ack, action, client, context }: any) {
  await ack();

  const fileId = action.value;
  await client.chat.postMessage({
    channel: context.channelId,
    thread_ts: context.threadTs,
    text: `📄 Extracting text from file ${fileId}...`,
  });
}

/** Store file */
async function handleFileStore({ ack, action, client, context }: any) {
  await ack();

  const fileId = action.value;
  await client.chat.postMessage({
    channel: context.channelId,
    thread_ts: context.threadTs,
    text: `💾 Storing file ${fileId}...`,
  });
}

/** Help button */
async function handleHelpAction({ ack, client, context }: any) {
  await ack();

  await client.chat.postEphemeral({
    channel: context.channelId,
    user: context.userId,
    text: "Help: Use `/agent-help` for full command list",
  });
}

/** Status button */
async function handleStatusAction({ ack, client, context }: any) {
  await ack();

  await client.chat.postEphemeral({
    channel: context.channelId,
    user: context.userId,
    text: "System status: Operational ✅",
  });
}

/** Generic action handler for unhandled actions */
async function handleGenericAction({ ack, action, client, context }: any) {
  await ack();

  logger.debug("Unhandled action", { actionId: (action as any).action_id, value: (action as any).value });
}
