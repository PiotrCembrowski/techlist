import "dotenv/config";
import { seedDemoData } from "../../src/db/seed";
import { createDb } from "../../src/lib/db";
import { migrateDatabase, resetSchema } from "../../scripts/db/lib";

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set for e2e tests");
  if (url === process.env.DATABASE_URL)
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
  await resetSchema(url);
  await migrateDatabase(url);
  const { db, client } = createDb(url, 2);
  try {
    await seedDemoData(db);
  } finally {
    await client.end();
  }
}
