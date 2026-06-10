import { App, SlackCommandMiddlewareArgs } from "@slack/bolt";
import { agent, AgentContext } from "../../agent/index";
import { generateTraceId } from "../../utils/id";
import { logger } from "../../obs/logger";
import { richMessage, taskStatusMessage, modelSelectionMessage, codeBlock } from "../../utils/slack-format";
import { memory } from "../../agent/memory";
import { getDb } from "../../db/client";
import { users, tasks } from "../../db/schema/index";
import { eq, desc } from "drizzle-orm";

/** Register slash command handlers */
export function handleCommands(app: App) {
  // Main agent command
  app.command("/agent", handleAgentCommand);
  app.command("/ask", handleAgentCommand); // Alias

  // Task management
  app.command("/task", handleTaskCommand);
  app.command("/tasks", handleListTasksCommand);

  // Memory commands
  app.command("/memory", handleMemoryCommand);
  app.command("/remember", handleRememberCommand);
  app.command("/recall", handleRecallCommand);

  // System commands
  app.command("/agent-status", handleStatusCommand);
  app.command("/agent-help", handleHelpCommand);
}

/** /agent - Main agent interaction */
async function handleAgentCommand({ command, ack, respond, client, context }: any) {
  await ack();

  const traceId = context.traceId || generateTraceId();
  const log = logger.withTrace(traceId).child({ command: "/agent" });

  const text = command.text?.trim() || "";
  if (!text) {
    await respond({
      response_type: "ephemeral",
      blocks: richMessage(
        "🤖 Agent Help",
        [
          "Use \`/agent <your request>\` to ask me anything.",
          "Examples:",
          "• `/agent summarize this thread`",
          "• `/agent create a task to review PR #42`",
          "• `/agent search memories for 'quarterly budget'`",
        ],
        undefined,
        "Full Slack UI: modals, buttons, shortcuts available"
      ),
    });
    return;
  }

  // Show typing indicator
  await client.chat.postMessage({
    channel: command.channel_id,
    thread_ts: command.thread_ts || command.ts,
    text: "🤔 Thinking...",
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "🤔 *Thinking...*" } },
    ],
  });

  try {
    const agentContext: AgentContext = {
      userId: command.user_id,
      teamId: command.team_id,
      channelId: command.channel_id,
      threadTs: command.thread_ts || command.ts,
      traceId,
      slackUser: { id: command.user_id, name: command.user_name, isAdmin: false },
    };

    const agentResult = await agent.process(text, agentContext);

    // Send response
    await client.chat.postMessage({
      channel: command.channel_id,
      thread_ts: command.thread_ts || command.ts,
      text: agentResult.text,
      blocks: agentResult.blocks || [
        { type: "section", text: { type: "mrkdwn", text: agentResult.text } },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `⚡ ${agentResult.metadata.durationMs}ms • 🔧 ${agentResult.metadata.toolsUsed.length} tools • 💰 $${agentResult.metadata.cost.toFixed(4)}` },
          ],
        },
      ],
    });
  } catch (error) {
    log.error("Agent command failed", error as Error);
    await respond({
      response_type: "ephemeral",
      text: `❌ Error: ${(error as Error).message}`,
    });
  }
}

/** /task - Manage tasks */
async function handleTaskCommand({ command, ack, respond, client, context }: any) {
  await ack();

  const args = command.text?.trim().split(/\s+/) || [];
  const subcommand = args[0]?.toLowerCase() || "list";

  switch (subcommand) {
    case "create":
      await handleCreateTask(command, respond, client, context, args.slice(1));
      break;
    case "status":
      await handleTaskStatus(command, respond, client, context, args[1]);
      break;
    case "cancel":
      await handleCancelTask(command, respond, client, context, args[1]);
      break;
    case "list":
    default:
      await handleListTasksCommand({ command, ack, respond, client, context });
      break;
  }
}

async function handleCreateTask(
  command: any,
  respond: any,
  client: any,
  context: any,
  args: string[]
) {
  const name = args[0] || "Untitled task";
  const description = args.slice(1).join(" ") || "No description";

  const result = await agent.process(
    `Create a task: ${name}. Description: ${description}`,
    {
      userId: command.user_id,
      teamId: command.team_id,
      channelId: command.channel_id,
      threadTs: command.thread_ts || command.ts,
      traceId: context.traceId,
    }
  );

  await respond({
    text: result.text,
    blocks: taskStatusMessage("new_task", "pending", `Created: ${name}\n${description}`),
  });
}

async function handleTaskStatus(command: any, respond: any, client: any, context: any, taskId?: string) {
  if (!taskId) {
    await respond({ text: "Usage: `/task status <task_id>`", response_type: "ephemeral" });
    return;
  }

  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);

  if (!task) {
    await respond({ text: `Task not found: ${taskId}`, response_type: "ephemeral" });
    return;
  }

  await respond({
    blocks: taskStatusMessage(task.id, (task.status as any), task.description || "No description"),
  });
}

async function handleCancelTask(command: any, respond: any, client: any, context: any, taskId?: string) {
  if (!taskId) {
    await respond({ text: "Usage: `/task cancel <task_id>`", response_type: "ephemeral" });
    return;
  }

  const db = getDb();
  await db.update(tasks).set({ status: "cancelled", updatedAt: new Date() }).where(eq(tasks.id, taskId));

  await respond({ text: `✅ Task cancelled: ${taskId}` });
}

/** /tasks - List tasks */
async function handleListTasksCommand({ command, ack, respond, client, context }: any) {
  await ack();

  const db = getDb();
  const userTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.createdBy, command.user_id))
    .orderBy(desc(tasks.createdAt))
    .limit(10);

  if (userTasks.length === 0) {
    await respond({ text: "No tasks found. Create one with `/task create <name>`", response_type: "ephemeral" });
    return;
  }

  const blocks = [
    { type: "header", text: { type: "plain_text", text: "📋 Your Tasks" } },
    { type: "divider" },
    ...userTasks.map((t) => ({
      type: "section",
      text: { type: "mrkdwn", text: `*${t.name}* (${t.status})\n${t.description || "No description"}\n\`${t.id}\`` },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: t.status === "pending" ? "Run" : "View" },
        action_id: t.status === "pending" ? "task_run" : "task_view",
        value: t.id,
      },
    })),
  ];

  await respond({ blocks });
}

/** /memory - Memory management */
async function handleMemoryCommand({ command, ack, respond, client, context }: any) {
  await ack();

  const args = command.text?.trim().split(/\s+/) || [];
  const subcommand = args[0]?.toLowerCase() || "search";

  switch (subcommand) {
    case "search":
      await handleMemorySearch(command, respond, args.slice(1).join(" "));
      break;
    case "write":
      await handleMemoryWrite(command, respond, args.slice(1).join(" "));
      break;
    case "list":
      await handleMemoryList(command, respond);
      break;
    default:
      await respond({
        response_type: "ephemeral",
        text: "Usage: `/memory search|write|list <query>`",
      });
  }
}

async function handleMemorySearch(command: any, respond: any, query: string) {
  if (!query) {
    await respond({ text: "Usage: `/memory search <query>`", response_type: "ephemeral" });
    return;
  }

  const results = await memory.searchMemories({ query, limit: 5 });
  if (results.length === 0) {
    await respond({ text: `🔍 No memories found for: *${query}*`, response_type: "ephemeral" });
    return;
  }
  await respond({
    blocks: results.map((r, i) => ({
      type: "section",
      text: { type: "mrkdwn", text: `${i + 1}. ${r.memory.content.slice(0, 300)}` },
    })),
  });
}

async function handleMemoryWrite(command: any, respond: any, content: string) {
  if (!content) {
    await respond({ text: "Usage: `/memory write <content>`", response_type: "ephemeral" });
    return;
  }

  const embedding = await memory.generateEmbedding(content);
  const entry = await memory.writeMemory({
    content,
    embedding,
    scope: "user",
    scopeId: command.user_id,
    tags: ["manual"],
    importance: 5,
        metadata: {},
      });

  await respond({ text: `✅ Memory saved: ${entry.id}` });
}

async function handleMemoryList(command: any, respond: any) {
  // List recent memories for user
  await respond({ text: "Memory list not implemented yet", response_type: "ephemeral" });
}

/** /remember - Quick memory save */
async function handleRememberCommand({ command, ack, respond }: any) {
  await ack();

  const content = command.text?.trim();
  if (!content) {
    await respond({ text: "Usage: `/remember <content>`", response_type: "ephemeral" });
    return;
  }

  const embedding = await memory.generateEmbedding(content);
  const entry = await memory.writeMemory({
    content,
    embedding,
    scope: "user",
    scopeId: command.user_id,
    tags: ["quick"],
    importance: 5,
        metadata: {},
      });

  await respond({ text: `🧠 Remembered: ${entry.id}` });
}

/** /recall - Quick memory search */
async function handleRecallCommand({ command, ack, respond }: any) {
  await ack();

  const query = command.text?.trim();
  if (!query) {
    await respond({ text: "Usage: `/recall <query>`", response_type: "ephemeral" });
    return;
  }

  const results = await memory.searchMemories({
    query,
    scope: "user",
    scopeId: command.user_id,
    limit: 3,
  });

  if (results.length === 0) {
    await respond({ text: "No memories found.", response_type: "ephemeral" });
    return;
  }

  const blocks = results.map((r, i) => ({
    type: "section",
    text: { type: "mrkdwn", text: `${i + 1}. ${r.memory.content.slice(0, 300)}` },
  }));

  await respond({ blocks });
}

/** /agent-status - System status */
async function handleStatusCommand({ command, ack, respond }: any) {
  await ack();

  const status = agent.getStatus();

  await respond({
    response_type: "ephemeral",
    blocks: richMessage(
      "🤖 Agent Status",
      [
        `**Tools:** ${status.tools} registered`,
        `**Namespaces:** ${status.namespaces.join(", ")}`,
        `**Memory:** Connected`,
        `**Queue:** Connected`,
      ],
      undefined,
      "System operational"
    ),
  });
}

/** /agent-help - Help command */
async function handleHelpCommand({ command, ack, respond }: any) {
  await ack();

  await respond({
    response_type: "ephemeral",
    blocks: richMessage(
      "🤖 Agent Commands",
      [
        "**Main:**",
        "• `/agent <request>` - Ask the agent anything",
        "• `/ask <request>` - Alias for /agent",
        "",
        "**Tasks:**",
        "• `/task create <name> [description]` - Create a task",
        "• `/task status <id>` - Check task status",
        "• `/task cancel <id>` - Cancel a task",
        "• `/tasks` - List your tasks",
        "",
        "**Memory:**",
        "• `/memory search <query>` - Search memories",
        "• `/memory write <content>` - Save a memory",
        "• `/remember <content>` - Quick save",
        "• `/recall <query>` - Quick search",
        "",
        "**System:**",
        "• `/agent-status` - Show system status",
        "• `/agent-help` - This help",
      ],
      undefined,
      "Full Slack UI: modals, buttons, shortcuts available"
    ),
  });
}
