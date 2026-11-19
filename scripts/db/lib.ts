import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../src/db/migrations");

export async function migrateDatabase(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

/** Drops everything in the public schema (and Drizzle's bookkeeping) — dev/test only. */
export async function resetSchema(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
    `);
  } finally {
    await client.end();
  }
}
