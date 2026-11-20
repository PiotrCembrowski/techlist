import "dotenv/config";
import { seedDemoData } from "../../src/db/seed";
import { createDb } from "../../src/lib/db";
import { createAdminUser } from "../../src/modules/admin-users/service";
import { migrateDatabase, resetSchema } from "../../scripts/db/lib";
import { E2E_ADMIN } from "./fixtures";

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
    // Journey D: the admin is created in test setup (no default credentials exist in the app).
    await createAdminUser({ db, actorId: null }, { ...E2E_ADMIN, role: "owner" });
  } finally {
    await client.end();
  }
}
