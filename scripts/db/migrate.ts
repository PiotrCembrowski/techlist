/**
 * Applies Drizzle migrations. Usage:
 *   pnpm db:migrate            # DATABASE_URL
 *   pnpm db:migrate --test     # TEST_DATABASE_URL
 *   pnpm db:migrate --fresh    # drop and recreate the schema first (refused in production)
 */
import "dotenv/config";
import { migrateDatabase, resetSchema } from "./lib";

const args = new Set(process.argv.slice(2));
const url = args.has("--test") ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error(args.has("--test") ? "TEST_DATABASE_URL is not set" : "DATABASE_URL is not set");
  process.exit(1);
}

if (args.has("--fresh")) {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to drop the schema with NODE_ENV=production");
    process.exit(1);
  }
  await resetSchema(url);
  console.log("Schema dropped and recreated.");
}
await migrateDatabase(url);
console.log("Migrations applied.");
