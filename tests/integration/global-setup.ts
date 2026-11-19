import "dotenv/config";
import { migrateDatabase, resetSchema } from "../../scripts/db/lib";

/** Runs once: migrations from scratch against an EMPTY test database. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error("TEST_DATABASE_URL must be set for integration tests (see .env.example)");
  if (url === process.env.DATABASE_URL)
    throw new Error(
      "TEST_DATABASE_URL must differ from DATABASE_URL — the test setup drops its schema",
    );
  await resetSchema(url);
  await migrateDatabase(url);
}
