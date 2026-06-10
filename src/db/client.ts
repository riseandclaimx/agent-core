import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL env var not set");
    }
    client = postgres(connectionString, {
      // Workers-compatible settings
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    db = drizzle(client);
  }

  return db;
}

export async function withDb<T>(fn: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const database = getDb();
  return fn(database);
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}
