import { handleSlackRequest } from "./slack/app";
import { closeDb } from "./db/client";
import { logger } from "./obs/logger";

export interface Env {
  // Slack
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  SLACK_APP_TOKEN?: string;

  // Database
  DATABASE_URL: string;

  // Upstash/QStash
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  QSTASH_URL?: string;
  QSTASH_TOKEN?: string;

  // Model APIs
  GROQ_API_KEY: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  CEREBRAS_API_KEY?: string;

  // Security
  ENCRYPTION_KEY: string;

  // Worker
  WORKER_URL: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Set global env for modules that need it
    Object.assign(process.env, env);

    const url = new URL(request.url);
    const traceId = request.headers.get("x-trace-id") || crypto.randomUUID();

    const log = logger.withTrace(traceId).child({ path: url.pathname });

    try {
      // Health check
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", traceId }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Metrics endpoint
      if (url.pathname === "/metrics") {
        const { metrics } = await import("./obs/metrics");
        const points = metrics.getPoints();
        return new Response(
          points.map((p) => `${p.name}{${Object.entries(p.tags).map(([k, v]) => `${k}="${v}"`).join(",")}} ${p.value} ${p.timestamp}`).join("\n"),
          { headers: { "Content-Type": "text/plain" } }
        );
      }

      // Slack events/commands/interactions
      if (url.pathname.startsWith("/slack")) {
        return handleSlackRequest(request, env);
      }

      // Task execution endpoint (for QStash)
      if (url.pathname === "/tasks/execute") {
        return handleTaskExecution(request, env, traceId);
      }

      // Cron trigger for scheduled tasks
      if (url.pathname === "/cron" || request.headers.get("x-cron") === "true") {
        return handleCron(request, env, traceId);
      }

      // Root
      if (url.pathname === "/") {
        return new Response("🤖 Agent Core - Cloudflare Worker", {
          headers: { "Content-Type": "text/plain" },
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      log.error("Worker error", error as Error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    Object.assign(process.env, env);
    await handleCron(new Request("http://internal/cron"), env, "cron-" + Date.now());
  },
};

/** Handle task execution from QStash */
async function handleTaskExecution(request: Request, env: Env, traceId: string): Promise<Response> {
  const log = logger.withTrace(traceId).child({ endpoint: "task_execute" });

  try {
    const body = await (request as any).json();
    const { taskId, name, payload, traceId: taskTraceId } = body;

    log.info("Executing task", { taskId, name });

    // Update task status
    const { updateTaskStatus } = await import("./queue/upstash");
    await updateTaskStatus(taskId, "running");

    // Process with agent
    const { agent } = await import("./agent/index");
    const agentContext = {
      userId: payload.userId,
      teamId: payload.teamId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      traceId: taskTraceId || traceId,
    };

    const response = await agent.process(`Execute task: ${name}. Payload: ${JSON.stringify(payload)}`, agentContext);

    await updateTaskStatus(taskId, "completed", { result: response });

    log.info("Task completed", { taskId });
    return new Response(JSON.stringify({ success: true, response }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    log.error("Task execution failed", error as Error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Handle cron triggers */
async function handleCron(request: Request, env: Env, traceId: string): Promise<Response> {
  const log = logger.withTrace(traceId).child({ endpoint: "cron" });

  try {
    // Run scheduled tasks
    const { getDb } = await import("./db/client");
    const { scheduledTasks } = await import("./db/schema/index");
    const { eq, lte, and } = await import("drizzle-orm");

    const db = getDb();
    const now = new Date();

    const dueTasks = await db
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.enabled, true), lte(scheduledTasks.nextRun, now)))
      .limit(10);

    for (const st of dueTasks) {
      log.info("Running scheduled task", { taskName: st.name });

      // Enqueue the task
      const { enqueueTask } = await import("./queue/upstash");
      await enqueueTask({
        name: st.name,
        payload: st.taskTemplate.payload,
        priority: st.taskTemplate.priority,
        tags: [...(st.taskTemplate.tags || []), "scheduled"],
      });

      // Update next run (simplified - would use cron parser)
      const nextRun = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour default
      await db
        .update(scheduledTasks)
        .set({ lastRun: now, nextRun, updatedAt: now })
        .where(eq(scheduledTasks.id, st.id));
    }

    return new Response(JSON.stringify({ ran: dueTasks.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    log.error("Cron failed", error as Error);
    return new Response("Cron error", { status: 500 });
  }
}
