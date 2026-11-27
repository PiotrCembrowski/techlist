/**
 * `pnpm worker [--drain] [--max-minutes N] [--max-jobs N] [--enqueue-sync]`
 *
 * Runs provider import jobs outside Next.js (DECISIONS D80).
 * - Without flags it runs until stopped, polling for jobs every 10 s (always-on host).
 * - `--drain --max-minutes 8` processes what is due and exits within the time budget (scheduled
 *   runs, e.g. the GitHub Actions workflow). Unfinished jobs pause and resume on the next run.
 * - `--enqueue-sync` first queues re-sync jobs for providers that have `syncEveryDays` set.
 * Each run also purges expired cached responses and old quota rows.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { sql } from "drizzle-orm";
import { getEnv } from "@/config/env";
import { closeDb, getDb } from "@/lib/db";
import { log } from "@/lib/log";
import { enqueueSyncJob } from "@/modules/import-jobs/service";
import { workLoop } from "@/modules/import-jobs/runner";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import { purgeExpiredResponses } from "@/modules/providers/core/cache";
import { pruneQuotaUsage } from "@/modules/providers/core/quota";
import type { ProviderKey } from "@/modules/providers/core/types";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const env = getEnv();
const db = getDb();
const drain = process.argv.includes("--drain");
const maxMinutes = Number(arg("--max-minutes") ?? 0);
const maxJobs = arg("--max-jobs") ? Number(arg("--max-jobs")) : undefined;
const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const deadline = new Date(Date.now() + (maxMinutes > 0 ? maxMinutes * 60_000 : 365 * 86_400_000));

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    // Finish the current item; the job is released and resumes later.
    stopping = true;
    log("info", "worker stopping", { workerId, signal: sig });
  });

try {
  ensureAdaptersRegistered(env);
  const purged = await purgeExpiredResponses(db);
  const pruned = await pruneQuotaUsage(db);
  if (process.argv.includes("--enqueue-sync")) {
    const rows = await db.execute<{ provider: string; days: number }>(sql`
      SELECT provider, (config->>'syncEveryDays')::int AS days FROM provider_settings
      WHERE enabled AND (config->>'syncEveryDays') ~ '^[0-9]+$'`);
    for (const r of rows) {
      const job = await enqueueSyncJob(
        { db, actorId: null },
        env,
        r.provider as ProviderKey,
        Number(r.days),
      ).catch((e: unknown) => {
        log("warn", "sync not queued", {
          provider: r.provider,
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      });
      if (job) log("info", "sync queued", { provider: r.provider, jobId: job.id });
    }
  }
  log("info", "worker started", { workerId, drain, maxMinutes, purged, pruned });
  const worked = await workLoop(db, {
    env,
    workerId,
    deadline,
    drain,
    maxJobs,
    shouldStop: () => stopping,
  });
  log("info", "worker finished", { workerId, jobs: worked });
} catch (e) {
  log("error", "worker crashed", { workerId, error: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
} finally {
  await closeDb();
}
