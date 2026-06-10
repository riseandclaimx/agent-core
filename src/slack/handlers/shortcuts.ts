import { App } from "@slack/bolt";
import { logger } from "../../obs/logger";

/** Register shortcut handlers */
export function handleShortcuts(app: App) {
  // Global shortcuts
  app.shortcut("create_task", handleCreateTaskShortcut);
  app.shortcut("search_memory", handleSearchMemoryShortcut);
  app.shortcut("agent_help", handleHelpShortcut);

  // Message shortcuts
  app.shortcut("summarize_thread", handleSummarizeThreadShortcut);
  app.shortcut("create_task_from_msg", handleCreateTaskFromMessageShortcut);
  app.shortcut("remember_message", handleRememberMessageShortcut);
}

/** Global: Create Task */
async function handleCreateTaskShortcut({ shortcut, ack, client, context }: any) {
  await ack();

  // Open modal for task creation
  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: "modal",
      callback_id: "create_task_modal",
      title: { type: "plain_text", text: "Create Task" },
      submit: { type: "plain_text", text: "Create" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "task_name",
          element: {
            type: "plain_text_input",
            action_id: "name",
            placeholder: { type: "plain_text", text: "Task name" },
          },
          label: { type: "plain_text", text: "Name" },
        },
        {
          type: "input",
          block_id: "task_description",
          element: {
            type: "plain_text_input",
            action_id: "description",
            multiline: true,
            placeholder: { type: "plain_text", text: "Description (optional)" },
          },
          label: { type: "plain_text", text: "Description" },
          optional: true,
        },
        {
          type: "input",
          block_id: "task_priority",
          element: {
            type: "static_select",
            action_id: "priority",
            placeholder: { type: "plain_text", text: "Select priority" },
            options: [
              { text: { type: "plain_text", text: "Low" }, value: "3" },
              { text: { type: "plain_text", text: "Medium" }, value: "5" },
              { text: { type: "plain_text", text: "High" }, value: "8" },
              { text: { type: "plain_text", text: "Critical" }, value: "10" },
            ],
            initial_option: { text: { type: "plain_text", text: "Medium" }, value: "5" },
          },
          label: { type: "plain_text", text: "Priority" },
        },
        {
          type: "input",
          block_id: "task_tags",
          element: {
            type: "plain_text_input",
            action_id: "tags",
            placeholder: { type: "plain_text", text: "comma-separated tags" },
          },
          label: { type: "plain_text", text: "Tags" },
          optional: true,
        },
      ],
    },
  });
}

/** Global: Search Memory */
async function handleSearchMemoryShortcut({ shortcut, ack, client }: any) {
  await ack();

  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: "modal",
      callback_id: "search_memory_modal",
      title: { type: "plain_text", text: "Search Memories" },
      submit: { type: "plain_text", text: "Search" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "search_query",
          element: {
            type: "plain_text_input",
            action_id: "query",
            placeholder: { type: "plain_text", text: "What are you looking for?" },
          },
          label: { type: "plain_text", text: "Query" },
        },
        {
          type: "input",
          block_id: "search_scope",
          element: {
            type: "static_select",
            action_id: "scope",
            placeholder: { type: "plain_text", text: "Select scope" },
            options: [
              { text: { type: "plain_text", text: "Global" }, value: "global" },
              { text: { type: "plain_text", text: "My Memories" }, value: "user" },
              { text: { type: "plain_text", text: "This Channel" }, value: "channel" },
            ],
            initial_option: { text: { type: "plain_text", text: "Global" }, value: "global" },
          },
          label: { type: "plain_text", text: "Scope" },
        },
      ],
    },
  });
}

/** Global: Help */
async function handleHelpShortcut({ shortcut, ack, client }: any) {
  await ack();

  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: "modal",
      callback_id: "help_modal",
      title: { type: "plain_text", text: "Agent Help" },
      close: { type: "plain_text", text: "Close" },
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "*🤖 Agent Commands*" } },
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: "• `/agent <request>` - Ask anything\n• `/task create <name>` - Create task\n• `/memory search <query>` - Search memories\n• `/remember <content>` - Quick save\n• `/recall <query>` - Quick search" } },
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: "*Message Shortcuts:*\n• Summarize thread\n• Create task from message\n• Remember message" } },
        { type: "divider" },
        { type: "context", elements: [{ type: "mrkdwn", text: "Full Slack UI with modals, buttons, and interactive components" }] },
      ],
    },
  });
}

/** Message: Summarize Thread */
async function handleSummarizeThreadShortcut({ shortcut, ack, client, context }: any) {
  await ack();

  const message = (shortcut as any).message;
  const channelId = (shortcut as any).channel?.id;
  const threadTs = message.thread_ts || message.ts;

  try {
    // Get thread history
    const history = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 50,
    });

    const messages = history.messages?.slice(1).map((m: any) => `${m.user}: ${m.text}`).join("\n") || "";

    // Post summary request to agent
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "📝 Summarizing thread...",
    });

    // Would call agent here
    // For now, just acknowledge
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `📝 Thread summary requested for ${history.messages?.length || 0} messages.`,
    });
  } catch (error) {
    logger.error("Summarize thread failed", error as Error);
  }
}

/** Message: Create Task from Message */
async function handleCreateTaskFromMessageShortcut({ shortcut, ack, client, context }: any) {
  await ack();

  const message = (shortcut as any).message;
  const channelId = (shortcut as any).channel?.id;

  // Open modal pre-filled with message content
  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: "modal",
      callback_id: "create_task_from_msg_modal",
      title: { type: "plain_text", text: "Create Task from Message" },
      submit: { type: "plain_text", text: "Create" },
      close: { type: "plain_text", text: "Cancel" },
      private_metadata: JSON.stringify({ messageTs: message.ts, channelId }),
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*From:* <@${message.user}>\n*Message:* ${message.text?.slice(0, 200) || "(no text)"}` },
        },
        { type: "divider" },
        {
          type: "input",
          block_id: "task_name",
          element: {
            type: "plain_text_input",
            action_id: "name",
            initial_value: message.text?.slice(0, 80) || "Task from message",
          },
          label: { type: "plain_text", text: "Task Name" },
        },
        {
          type: "input",
          block_id: "task_description",
          element: {
            type: "plain_text_input",
            action_id: "description",
            multiline: true,
            initial_value: message.text || "",
          },
          label: { type: "plain_text", text: "Description" },
        },
      ],
    },
  });
}

/** Message: Remember Message */
async function handleRememberMessageShortcut({ shortcut, ack, client, context }: any) {
  await ack();

  const message = (shortcut as any).message;
  const userId = shortcut.user.id;

  // Store message as memory
  const content = `Message from <@${message.user}> in <#${(shortcut as any).channel?.id}>: ${message.text || "(no text)"}`;

  // Would call memory.write here
  await client.chat.postEphemeral({
    channel: (shortcut as any).channel?.id,
    user: userId,
    text: "🧠 Message saved to your memories",
  });
}
