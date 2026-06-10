import pino from "pino";
import { generateTraceId, generateSpanId } from "../utils/id";

const isDev = process.env.NODE_ENV !== "production";

const baseLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
    },
  }),
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
});

export interface LogContext {
  traceId?: string;
  spanId?: string;
  userId?: string;
  channelId?: string;
  threadTs?: string;
  toolName?: string;
  model?: string;
  step?: number;
  [key: string]: unknown;
}

export class Logger {
  private logger: pino.Logger;
  private defaultContext: LogContext;

  constructor(context: LogContext = {}) {
    this.defaultContext = context;
    this.logger = baseLogger.child(context);
  }

  child(context: LogContext): Logger {
    return new Logger({ ...this.defaultContext, ...context });
  }

  withTrace(traceId: string, spanId?: string): Logger {
    return this.child({ traceId, spanId: spanId || generateSpanId() });
  }

  withTool(toolName: string): Logger {
    return this.child({ toolName });
  }

  withModel(model: string): Logger {
    return this.child({ model });
  }

  withStep(step: number): Logger {
    return this.child({ step });
  }

  debug(msg: string, context?: LogContext): void {
    this.logger.debug({ ...this.defaultContext, ...context }, msg);
  }

  info(msg: string, context?: LogContext): void {
    this.logger.info({ ...this.defaultContext, ...context }, msg);
  }

  warn(msg: string, context?: LogContext): void {
    this.logger.warn({ ...this.defaultContext, ...context }, msg);
  }

  error(msg: string, error?: Error, context?: LogContext): void {
    this.logger.error(
      { ...this.defaultContext, ...context, err: error?.message, stack: error?.stack },
      msg
    );
  }

  fatal(msg: string, error?: Error, context?: LogContext): void {
    this.logger.fatal(
      { ...this.defaultContext, ...context, err: error?.message, stack: error?.stack },
      msg
    );
  }

  /** Log tool invocation */
  toolCall(toolName: string, args: unknown, result?: unknown, error?: Error): void {
    const child = this.withTool(toolName);
    if (error) {
      child.error(`Tool failed: ${toolName}`, error, { args, error: error.message });
    } else {
      child.info(`Tool completed: ${toolName}`, { args, result: result ? "ok" : "void" });
    }
  }

  /** Log model call */
  modelCall(model: string, promptTokens: number, completionTokens: number, latencyMs: number): void {
    this.withModel(model).info("Model call completed", {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      latencyMs,
      costUsd: this.estimateCost(model, promptTokens, completionTokens),
    });
  }

  private estimateCost(model: string, prompt: number, completion: number): number {
    // Rough estimates per 1M tokens
    const rates: Record<string, { in: number; out: number }> = {
      "groq:openai/gpt-oss-20b": { in: 0, out: 0 }, // Free
      "groq:llama-3.3-70b-versatile": { in: 0, out: 0 },
      "deepseek:deepseek-chat": { in: 0.14, out: 0.28 },
      "gemini:gemini-1.5-flash": { in: 0.075, out: 0.3 },
      "openai:gpt-4o-mini": { in: 0.15, out: 0.6 },
      "anthropic:claude-3.5-sonnet": { in: 3, out: 15 },
    };
    const rate = rates[model] || { in: 1, out: 3 };
    return (prompt / 1_000_000) * rate.in + (completion / 1_000_000) * rate.out;
  }
}

export const logger = new Logger({ service: "agent-core" });

export function createRequestLogger(traceId?: string): Logger {
  return logger.withTrace(traceId || generateTraceId());
}
