import { and, asc, eq, sql } from "drizzle-orm";
import { importJobItems, importJobs, sources } from "@/db/schema";
import type { Env } from "@/config/env";
import type { DbOrTx } from "@/lib/db";
import { log } from "@/lib/log";
import { importNormalizedProduct, type ImportOutcome } from "@/modules/import-core/apply";
import { loadNormalizeContext, mapCategory } from "@/modules/import-core/mappings";
import { normalizeRecord } from "@/modules/import-core/normalize";
import { httpClientFor } from "@/modules/providers/core/config";
import { ProviderHttpError } from "@/modules/providers/core/http";
import { ProviderQuotaExceededError } from "@/modules/providers/core/quota";
import { getProviderSettings, providerAvailability } from "@/modules/providers/core/settings";
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderKey,
  ProviderRecord,
} from "@/modules/providers/core/types";
import { previewRecord } from "./preview";
import type { ImportJob, ImportJobItem, JobQuery } from "./service";

/**
 * The worker side of provider jobs (DECISIONS D80):
 * - a job is claimed with FOR UPDATE SKIP LOCKED and a lease (locked_until); a job whose lease
 *   expired (crashed worker) can be taken over, and its pending items continue where they stopped;
 * - items run in batches; every item is one transaction (importNormalizedProduct), so a crash never
 *   leaves half an item, and re-running an item is idempotent;
 * - quota exhaustion or a long Retry-After puts the job back in the queue until the reset time;
 * - a cancel request is honoured between items; a time budget (deadline) pauses the job.
 */

export const LEASE_MS = 5 * 60_000;
const MAX_ITEM_ATTEMPTS = 3;

export type RunResult = "committed" | "cancelled" | "paused" | "rescheduled" | "failed";

/** Claims the next runnable provider job for this worker, or returns null. */
export async function claimNextJob(
  db: DbOrTx,
  workerId: string,
  now = new Date(),
): Promise<ImportJob | null> {
  const lease = new Date(now.getTime() + LEASE_MS);
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE import_jobs SET status = 'running', locked_by = ${workerId}, locked_until = ${lease.toISOString()}::timestamptz,
           started_at = coalesce(started_at, ${now.toISOString()}::timestamptz), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM import_jobs
      WHERE kind = 'provider'
        AND ((status = 'queued' AND run_after <= ${now.toISOString()}::timestamptz)
          OR (status = 'running' AND locked_until < ${now.toISOString()}::timestamptz))
      ORDER BY run_after, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
    RETURNING id`);
  if (!rows[0]) return null;
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, rows[0].id));
  return job ?? null;
}

async function release(db: DbOrTx, jobId: string, set: Partial<typeof importJobs.$inferInsert>) {
  await db
    .update(importJobs)
    .set({ lockedBy: null, lockedUntil: null, ...set })
    .where(eq(importJobs.id, jobId));
}

async function refreshCounts(db: DbOrTx, jobId: string) {
  await db.execute(sql`
    UPDATE import_jobs j SET
      total_rows = c.total, successful_rows = c.ok, failed_rows = c.failed, skipped_rows = c.skipped
    FROM (SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE status IN ('applied', 'unchanged'))::int AS ok,
                 count(*) FILTER (WHERE status = 'failed')::int AS failed,
                 count(*) FILTER (WHERE status = 'skipped')::int AS skipped
          FROM import_job_items WHERE job_id = ${jobId}) c
    WHERE j.id = ${jobId}`);
}

function itemStatus(o: ImportOutcome): ImportJobItem["status"] {
  switch (o.status) {
    case "created":
    case "updated":
      return "applied";
    case "unchanged":
      return "unchanged";
    case "needs_review":
    case "blocked":
      return "needs_review";
    case "skipped":
      return "skipped";
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export interface RunOptions {
  env: Env;
  workerId: string;
  /** Stop (pause) after this time; the job resumes on the next run. */
  deadline: Date;
  batchSize?: number;
  now?: () => Date;
}

/** Runs a claimed job until it finishes, is cancelled, runs out of quota or time. */
export async function runJob(db: DbOrTx, claimed: ImportJob, opts: RunOptions): Promise<RunResult> {
  const now = opts.now ?? (() => new Date());
  const provider = claimed.provider as ProviderKey;
  const query = claimed.query as JobQuery;
  const fail = async (message: string) => {
    await release(db, claimed.id, { status: "failed", lastError: message, completedAt: now() });
    log("warn", "import job failed", { jobId: claimed.id, provider, error: message });
    return "failed" as const;
  };

  const availability = await providerAvailability(db, provider, opts.env);
  if (!availability.runnable) return fail(`Provider not available: ${availability.reason}`);
  const adapter = availability.adapter;
  const [source] = await db.select().from(sources).where(eq(sources.id, claimed.sourceId));
  if (!source?.usagePermitted) return fail("The provider's source is not marked usage permitted");
  const settings = await getProviderSettings(db, provider);
  const dailyCap =
    Number((settings?.config as { dailyCap?: number } | undefined)?.dailyCap) || null;
  const pctx: ProviderContext = { db, http: httpClientFor(adapter, opts.env, db, { dailyCap }) };
  const maxItems =
    Number((claimed.caps as { maxItems?: number } | null)?.maxItems) ||
    opts.env.IMPORT_JOB_MAX_ITEMS;

  try {
    // Discovery: a search job turns its hits into items once (checkpointed).
    const checkpoint = (claimed.checkpoint ?? {}) as { discovered?: boolean; totalHits?: number };
    if (query.mode === "search" && !checkpoint.discovered) {
      const hits = await adapter.search!(query.text!, pctx);
      const keep = hits.slice(0, maxItems);
      if (keep.length)
        await db
          .insert(importJobItems)
          .values(
            keep.map((h, i) => ({
              jobId: claimed.id,
              seq: i + 1,
              externalKey: h.providerProductId,
            })),
          )
          .onConflictDoNothing();
      await db
        .update(importJobs)
        .set({ checkpoint: { discovered: true, totalHits: hits.length, kept: keep.length } })
        .where(eq(importJobs.id, claimed.id));
    }

    const categoryCache = new Map<string, Awaited<ReturnType<typeof mapCategory>>>();
    for (;;) {
      if (now() >= opts.deadline) {
        await refreshCounts(db, claimed.id);
        await release(db, claimed.id, { status: "queued", runAfter: new Date() }); // resume at once
        return "paused";
      }
      const [current] = await db
        .select({ cancel: importJobs.cancelRequestedAt })
        .from(importJobs)
        .where(eq(importJobs.id, claimed.id));
      if (current?.cancel) {
        await refreshCounts(db, claimed.id);
        await release(db, claimed.id, { status: "cancelled", completedAt: now() });
        return "cancelled";
      }
      const batch = await db
        .select()
        .from(importJobItems)
        .where(and(eq(importJobItems.jobId, claimed.id), eq(importJobItems.status, "pending")))
        .orderBy(asc(importJobItems.seq))
        .limit(opts.batchSize ?? 10);
      if (batch.length === 0) {
        await refreshCounts(db, claimed.id);
        await release(db, claimed.id, { status: "committed", completedAt: now(), lastError: null });
        return "committed";
      }
      for (const item of batch) {
        const r = await processItem(db, item, {
          adapter,
          pctx,
          query,
          source,
          categoryCache,
          opts,
        });
        if (r !== "continue") {
          await refreshCounts(db, claimed.id);
          return r;
        }
        if (now() >= opts.deadline) break;
      }
      // Heartbeat: keep the lease while working.
      await db
        .update(importJobs)
        .set({ lockedUntil: new Date(now().getTime() + LEASE_MS) })
        .where(eq(importJobs.id, claimed.id));
      await refreshCounts(db, claimed.id);
    }
  } catch (e) {
    return handleJobError(db, claimed, e, now, fail);
  }
}

async function handleJobError(
  db: DbOrTx,
  job: ImportJob,
  e: unknown,
  now: () => Date,
  fail: (m: string) => Promise<"failed">,
): Promise<RunResult> {
  if (e instanceof ProviderQuotaExceededError) {
    await release(db, job.id, { status: "queued", runAfter: e.resetsAt, lastError: e.message });
    log("info", "import job waiting for quota", { jobId: job.id, until: e.resetsAt.toISOString() });
    return "rescheduled";
  }
  if (e instanceof ProviderHttpError && e.retryable) {
    const wait = e.retryAfterMs ?? 15 * 60_000;
    await release(db, job.id, {
      status: "queued",
      runAfter: new Date(now().getTime() + wait),
      lastError: e.message,
    });
    return "rescheduled";
  }
  return fail(errorText(e));
}

async function processItem(
  db: DbOrTx,
  item: ImportJobItem,
  c: {
    adapter: ProviderAdapter;
    pctx: ProviderContext;
    query: JobQuery;
    source: typeof sources.$inferSelect;
    categoryCache: Map<string, Awaited<ReturnType<typeof mapCategory>>>;
    opts: RunOptions;
  },
): Promise<"continue" | RunResult> {
  const setItem = (set: Partial<typeof importJobItems.$inferInsert>) =>
    db.update(importJobItems).set(set).where(eq(importJobItems.id, item.id));
  let records: ProviderRecord[];
  try {
    if (c.query.mode === "gtin") records = await c.adapter.lookupByGtin!(item.externalKey, c.pctx);
    else {
      const r = await c.adapter.fetchById!(item.externalKey, c.pctx);
      records = r ? [r] : [];
    }
  } catch (e) {
    if (
      e instanceof ProviderQuotaExceededError ||
      (e instanceof ProviderHttpError && e.retryAfterMs)
    )
      throw e;
    const attempts = item.attempts + 1;
    const retryable = e instanceof ProviderHttpError && e.retryable;
    await setItem({
      attempts,
      error: errorText(e),
      status: retryable && attempts < MAX_ITEM_ATTEMPTS ? "pending" : "failed",
    });
    return "continue";
  }

  if (records.length === 0) {
    // Never delete or change anything because a provider no longer returns a record.
    await setItem({ status: "skipped", attempts: item.attempts + 1, result: { notFound: true } });
    return "continue";
  }

  try {
    if (c.query.dryRun) {
      const previews = [];
      for (const r of records) previews.push(await previewRecord(db, c.adapter, r));
      await setItem({
        status: "skipped",
        attempts: item.attempts + 1,
        result: { preview: previews },
      });
      return "continue";
    }
    const outcomes: ImportOutcome[] = [];
    for (const record of records) {
      const key = record.categoryExternalId ?? "";
      if (!c.categoryCache.has(key))
        c.categoryCache.set(key, await mapCategory(db, record.provider, record.categoryExternalId));
      const category = c.categoryCache.get(key) ?? null;
      const nctx = await loadNormalizeContext(
        db,
        record.provider,
        category,
        c.adapter.recordConfidence?.(record) ?? 0.7,
      );
      outcomes.push(
        await importNormalizedProduct(
          { db, actorId: null },
          {
            product: normalizeRecord(record, nctx),
            source: { id: c.source.id, provider: record.provider, licence: c.adapter.licence },
            category,
            raw: record,
          },
        ),
      );
    }
    // The item's status is the "most attention needed" of its records.
    const rank: ImportJobItem["status"][] = ["needs_review", "applied", "unchanged", "skipped"];
    const statuses = outcomes.map(itemStatus);
    const status = rank.find((s) => statuses.includes(s)) ?? "skipped";
    await setItem({
      status,
      attempts: item.attempts + 1,
      error: null,
      productId: outcomes[0]?.productId ?? null,
      variantId: outcomes[0]?.variantId ?? null,
      payloadHash: records[0]?.payloadHash ?? null,
      result: {
        records: outcomes.map((o, i) => ({
          providerProductId: records[i]!.providerProductId,
          status: o.status,
          productId: o.productId,
          variantId: o.variantId,
          reviewItemIds: o.reviewItemIds,
          notes: o.notes,
          changes: o.changes.length,
        })),
      },
    });
  } catch (e) {
    await setItem({ status: "failed", attempts: item.attempts + 1, error: errorText(e) });
    log("warn", "import item failed", {
      jobId: item.jobId,
      item: item.externalKey,
      error: errorText(e),
    });
  }
  return "continue";
}

/**
 * Worker loop: claims and runs jobs until the deadline. `drain` stops when nothing is runnable;
 * otherwise it polls. Returns the number of jobs it worked on.
 */
export async function workLoop(
  db: DbOrTx,
  opts: {
    env: Env;
    workerId: string;
    deadline: Date;
    drain: boolean;
    maxJobs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    shouldStop?: () => boolean;
  },
): Promise<number> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let worked = 0;
  while (new Date() < opts.deadline && !opts.shouldStop?.()) {
    if (opts.maxJobs !== undefined && worked >= opts.maxJobs) break;
    const job = await claimNextJob(db, opts.workerId);
    if (!job) {
      if (opts.drain) break;
      await sleep(opts.pollMs ?? 10_000);
      continue;
    }
    worked++;
    const result = await runJob(db, job, {
      env: opts.env,
      workerId: opts.workerId,
      deadline: opts.deadline,
    });
    log("info", "import job run", { jobId: job.id, provider: job.provider, result });
  }
  return worked;
}
