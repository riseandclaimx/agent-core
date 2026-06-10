/** Simple in-memory metrics with periodic flush */
export interface MetricPoint {
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: number;
}

class MetricsCollector {
  private points: MetricPoint[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxPoints = 10000;

  constructor() {
    if (typeof globalThis !== "undefined") {
      this.flushInterval = setInterval(() => this.flush(), 30_000);
    }
  }

  increment(name: string, tags: Record<string, string> = {}, value = 1): void {
    this.record(name, value, tags);
  }

  gauge(name: string, value: number, tags: Record<string, string> = {}): void {
    this.record(name, value, tags);
  }

  histogram(name: string, value: number, tags: Record<string, string> = {}): void {
    this.record(name, value, tags);
  }

  timing(name: string, startTime: number, tags: Record<string, string> = {}): void {
    this.histogram(name, Date.now() - startTime, tags);
  }

  private record(name: string, value: number, tags: Record<string, string>): void {
    this.points.push({ name, value, tags, timestamp: Date.now() });
    if (this.points.length > this.maxPoints) {
      this.points = this.points.slice(-this.maxPoints);
    }
  }

  flush(): MetricPoint[] {
    const points = [...this.points];
    this.points = [];
    return points;
  }

  getPoints(): MetricPoint[] {
    return [...this.points];
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }
}

export const metrics = new MetricsCollector();

/** Pre-defined metric names */
export const METRICS = {
  // Agent
  AGENT_STEPS: "agent.steps",
  AGENT_DURATION_MS: "agent.duration_ms",
  AGENT_TOKENS_TOTAL: "agent.tokens_total",
  AGENT_COST_USD: "agent.cost_usd",
  AGENT_ERRORS: "agent.errors",

  // Model
  MODEL_CALLS: "model.calls",
  MODEL_LATENCY_MS: "model.latency_ms",
  MODEL_TOKENS_IN: "model.tokens_in",
  MODEL_TOKENS_OUT: "model.tokens_out",
  MODEL_COST_USD: "model.cost_usd",
  MODEL_FALLBACKS: "model.fallbacks",

  // Tools
  TOOL_CALLS: "tool.calls",
  TOOL_LATENCY_MS: "tool.latency_ms",
  TOOL_ERRORS: "tool.errors",
  TOOL_RETRIES: "tool.retries",

  // Memory
  MEMORY_QUERIES: "memory.queries",
  MEMORY_LATENCY_MS: "memory.latency_ms",
  MEMORY_RESULTS: "memory.results",
  MEMORY_WRITES: "memory.writes",

  // Slack
  SLACK_EVENTS: "slack.events",
  SLACK_COMMANDS: "slack.commands",
  SLACK_RESPONSE_MS: "slack.response_ms",

  // Tasks
  TASKS_ENQUEUED: "tasks.enqueued",
  TASKS_COMPLETED: "tasks.completed",
  TASKS_FAILED: "tasks.failed",
  TASK_DURATION_MS: "tasks.duration_ms",

  // Database
  DB_QUERIES: "db.queries",
  DB_LATENCY_MS: "db.latency_ms",
  DB_ERRORS: "db.errors",
} as const;