/** `pnpm db:seed` — idempotent demo seed. Refuses to run in production unless ALLOW_DEMO_SEED=true. */
import "dotenv/config";
import { assertSeedAllowed, countRows, seedDemoData } from "@/db/seed";
import { closeDb, getDb } from "@/lib/db";

try {
  assertSeedAllowed(process.env);
  const db = getDb();
  const before = await countRows(db);
  await seedDemoData(db, { log: (m) => console.log(`  ${m}`) });
  const after = await countRows(db);
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  console.log(
    changed.length
      ? `Seeded. Row counts changed: ${changed.map((k) => `${k} ${before[k]}→${after[k]}`).join(", ")}`
      : "Seeded. No row counts changed (already up to date).",
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
