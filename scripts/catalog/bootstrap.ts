/**
 * `pnpm catalog:bootstrap [--dry-run]` — creates the import target categories (smartphones,
 * laptops, CPUs, GPUs, monitors, headphones) and their specification definitions where missing.
 * Never modifies existing definitions; prints conflicts instead. Safe to run repeatedly.
 */
import "dotenv/config";
import { closeDb, getDb } from "@/lib/db";
import { bootstrapCatalog } from "@/modules/import-core/bootstrap";

const dryRun = process.argv.includes("--dry-run");
try {
  const reports = await bootstrapCatalog({ db: getDb(), actorId: null }, { dryRun });
  for (const r of reports) {
    console.log(
      `${r.slug}: ${r.categoryCreated ? "category created; " : ""}` +
        `${r.groupsCreated.length} groups and ${r.definitionsCreated.length} definitions created` +
        (r.conflicts.length ? `; ${r.conflicts.length} conflicts` : ""),
    );
    for (const c of r.conflicts) console.log(`  ! ${c.key}: ${c.reason}`);
  }
  if (dryRun) console.log("Dry run: nothing was written.");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
