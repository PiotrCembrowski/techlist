import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/config/env";
import * as schema from "@/db/schema";

export type Database = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction; services accept either. */
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

type DbGlobal = { __specbaseDb?: { db: Database; client: postgres.Sql } };
const g = globalThis as unknown as DbGlobal;

export function createDb(url: string, max = 10) {
  const client = postgres(url, { max, prepare: true, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDb(): Database {
  if (!g.__specbaseDb) {
    const env = getEnv();
    g.__specbaseDb = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  }
  return g.__specbaseDb.db;
}

export async function closeDb() {
  if (g.__specbaseDb) {
    await g.__specbaseDb.client.end({ timeout: 5 });
    g.__specbaseDb = undefined;
  }
}
