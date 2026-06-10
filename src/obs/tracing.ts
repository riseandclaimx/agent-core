import { generateTraceId, generateSpanId } from "../utils/id";
import { logger, LogContext } from "./logger";

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  tags: Record<string, string | number | boolean>;
  logs: { timestamp: number; message: string; fields?: Record<string, unknown> }[];
  status: "ok" | "error";
}

export class Tracer {
  private spans: Map<string, Span> = new Map();
  private rootSpanId?: string;

  startSpan(name: string, parent?: Span, tags: Record<string, string | number | boolean> = {}): Span {
    const traceId = parent?.traceId || generateTraceId();
    const spanId = generateSpanId();
    const span: Span = {
      traceId,
      spanId,
      parentSpanId: parent?.spanId,
      name,
      startTime: Date.now(),
      tags: { ...tags, "span.kind": "internal" },
      logs: [],
      status: "ok",
    };
    this.spans.set(spanId, span);
    if (!this.rootSpanId) this.rootSpanId = spanId;
    return span;
  }

  endSpan(span: Span, status: "ok" | "error" = "ok"): void {
    span.endTime = Date.now();
    span.status = status;
  }

  addLog(span: Span, message: string, fields?: Record<string, unknown>): void {
    span.logs.push({ timestamp: Date.now(), message, fields });
  }

  addTag(span: Span, key: string, value: string | number | boolean): void {
    span.tags[key] = value;
  }

  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  getRootSpan(): Span | undefined {
    return this.rootSpanId ? this.spans.get(this.rootSpanId) : undefined;
  }

  getAllSpans(): Span[] {
    return [...this.spans.values()].sort((a, b) => a.startTime - b.startTime);
  }

  clear(): void {
    this.spans.clear();
    this.rootSpanId = undefined;
  }

  /** Export as JSON for logging/analysis */
  toJSON(): unknown {
    return this.getAllSpans().map((s) => ({
      traceId: s.traceId,
      spanId: s.spanId,
      parentSpanId: s.parentSpanId,
      name: s.name,
      durationMs: s.endTime ? s.endTime - s.startTime : null,
      tags: s.tags,
      logs: s.logs,
      status: s.status,
    }));
  }
}

/** Global tracer instance (per-request in practice) */
export const tracer = new Tracer();

/** Create a traced function wrapper */
export function traced<T extends (...args: unknown[]) => Promise<unknown>>(
  name: string,
  fn: T,
  tags?: Record<string, string | number | boolean>
): T {
  return (async (...args: unknown[]) => {
    const span = tracer.startSpan(name, undefined, tags);
    try {
      const result = await fn(...args);
      tracer.endSpan(span, "ok");
      return result;
    } catch (error) {
      tracer.addLog(span, "Error", { error: (error as Error).message });
      tracer.endSpan(span, "error");
      throw error;
    }
  }) as T;
}

/** Middleware to add trace context to logger */
export function withTraceContext<T>(
  traceId: string,
  fn: (log: any) => Promise<T>
): Promise<T> {
  const log = logger.withTrace(traceId);
  return fn(log);
}
