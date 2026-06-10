import { toolRegistry } from "./registry";
import { toolDefinitions, ToolName } from "./definitions";
import { logger } from "../../obs/logger";
import { metrics, METRICS } from "../../obs/metrics";

export interface ExecutionOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

/** Execute a tool with retries, timeout, and error handling */
export async function executeTool(
  name: ToolName,
  args: unknown,
  context: { userId: string; teamId: string; traceId: string; step: number },
  options: ExecutionOptions = {}
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const { maxRetries = 0, retryDelay = 1000, timeout = 30000 } = options;
  const log = logger.withTool(name).withTrace(context.traceId).withStep(context.step);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const result = await toolRegistry.execute(name, args, {
        ...context,
        metadata: { ...(context as any).metadata, attempt },
      });

      clearTimeout(timeout as any)

      if (attempt > 0) {
        metrics.increment(METRICS.TOOL_RETRIES, { tool: name, attempt: String(attempt) });
        log.info("Tool succeeded after retry");
      }

      return { success: true, result };
    } catch (error) {
      lastError = error as Error;
      clearTimeout(timeoutId);

      if (attempt < maxRetries) {
        log.warn("Tool failed, retrying");
        await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
        continue;
      }

      log.error("Tool failed after all retries", error as Error);
    }
  }

  return { success: false, error: lastError?.message || "Unknown error" };
}

/** Execute multiple tools in parallel */
export async function executeToolsParallel(
  calls: { name: ToolName; args: unknown }[],
  context: { userId: string; teamId: string; traceId: string; step: number },
  options: ExecutionOptions = {}
): Promise<{ name: ToolName; success: boolean; result?: unknown; error?: string }[]> {
  const results = await Promise.all(
    calls.map((call) =>
      executeTool(call.name, call.args, context, options).then((r) => ({ name: call.name, ...r }))
    )
  );
  return results;
}

/** Execute tools sequentially (for dependent calls) */
export async function executeToolsSequential(
  calls: { name: ToolName; args: unknown }[],
  context: { userId: string; teamId: string; traceId: string; step: number },
  options: ExecutionOptions = {}
): Promise<{ name: ToolName; success: boolean; result?: unknown; error?: string }[]> {
  const results = [];
  for (const call of calls) {
    const result = await executeTool(call.name, call.args, context, options);
    results.push({ name: call.name, ...result });
    if (!result.success && options.maxRetries === 0) {
      // Stop on first failure if no retries
      break;
    }
  }
  return results;
}

/** Get tool schema for LLM function calling */
export function getToolSchemas(): ReturnType<typeof toolRegistry.getFunctionSchemas> {
  return toolRegistry.getFunctionSchemas();
}

/** Get available tool names */
export function getAvailableTools(): ToolName[] {
  return toolRegistry.getAll().map((t) => t.name);
}

/** Check if a tool exists */
export function hasTool(name: string): name is ToolName {
  return toolRegistry.get(name as ToolName) !== undefined;
}
