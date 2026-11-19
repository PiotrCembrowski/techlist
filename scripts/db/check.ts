/** Verifies the database is reachable, is PostgreSQL >= 16, and has the required extensions available. */
import "dotenv/config";
import postgres from "postgres";

const url = process.argv.includes("--test")
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;
if (!url) throw new Error("Database URL not set");
const sql = postgres(url, { max: 1, connect_timeout: 5 });
try {
  const [row] = await sql<{ v: number }[]>`SELECT current_setting('server_version_num')::int AS v`;
  const server_version_num = row?.v ?? 0;
  const ext =
    await sql`SELECT name FROM pg_available_extensions WHERE name IN ('pg_trgm', 'unaccent') ORDER BY name`;
  const major = Math.floor(server_version_num / 10000);
  console.log(
    `Connected: PostgreSQL ${major}; extensions available: ${ext.map((e) => e.name).join(", ")}`,
  );
  if (major < 16) throw new Error("PostgreSQL 16 or newer is required (UNIQUE NULLS NOT DISTINCT)");
  if (ext.length !== 2) throw new Error("pg_trgm and unaccent must be available");
} finally {
  await sql.end();
}
