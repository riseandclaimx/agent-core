import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema/index";
import { logger } from "../obs/logger";
import { metrics, METRICS } from "../obs/metrics";

let sql: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getSql(): postgres.Sql {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    sql = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: (notice) => logger.debug("Postgres notice", { notice: notice.message }),
      transform: {
        ...postgres.camel,
        undefined: null,
      },
    });
  }
  return sql;
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    db = drizzle(getSql(), { schema, logger: false });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
    db = null;
  }
}

/** Execute a query with metrics and logging */
export async function withDb<T>(
  operation: string,
  fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>
): Promise<T> {
  const start = Date.now();
  const log = logger.child({ operation, component: "db" });
  try {
    const result = await fn(getDb());
    metrics.timing(METRICS.DB_LATENCY_MS, start, { operation });
    metrics.increment(METRICS.DB_QUERIES, { operation, status: "success" });
    return result;
  } catch (error) {
    metrics.increment(METRICS.DB_ERRORS, { operation, error: (error as Error).name });
    log.error(`DB operation failed: ${operation}`, error as Error);
    throw error;
  }
}

/** Health check */
export async function checkDbHealth(): Promise<boolean> {
  try {
    await getSql()`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Run migrations (call at startup) */
export async function runMigrations(): Promise<void> {
  // In production, use `drizzle-kit migrate` via CI/CD
  // This is for local dev only
  if (process.env.NODE_ENV !== "production") {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(getDb(), { migrationsFolder: "./src/db/migrations" });
  }
}

export { schema };
