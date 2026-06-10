/**
 * Database client — connects to the same Neon PostgreSQL as the main agent.
 * Uses postgres-js (HTTP-compatible, same driver as the fixed agent-core).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    const client = postgres(url, { ssl: "require", max: 10 });
    db = drizzle(client);
  }
  return db;
}
