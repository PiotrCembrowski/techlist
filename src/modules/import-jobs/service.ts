import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { importJobItems, importJobs } from "@/db/schema";
import type { Env } from "@/config/env";
import type { DbOrTx } from "@/lib/db";
import { partitionGtins } from "@/lib/gtin";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import {
  ConflictError,
  InvalidStateError,
  NotFoundError,
  parseOrThrow,
  ValidationError,
} from "@/modules/_shared/errors";
import { providerAvailability } from "@/modules/providers/core/settings";
import type { ProviderKey } from "@/modules/providers/core/types";
import { ensureProviderSource } from "./sources";

export type ImportJob = typeof importJobs.$inferSelect;
export type ImportJobItem = typeof importJobItems.$inferSelect;

/**
 * Provider import jobs (DECISIONS D80). A job is a list of items (GTINs or provider IDs, or the
 * hits of one search) processed by the worker in batches. `dryRun` jobs only preview: they fetch
 * and match but write nothing to the catalogue.
 */
export const jobQuerySchema = z
  .object({
    mode: z.enum(["gtin", "ids", "search"]),
    /** GTINs (gtin) or provider product IDs (ids). */
    values: z.array(z.string().trim().min(1).max(80)).max(5000).default([]),
    /** Search text (search mode), e.g. "brand model". */
    text: z.string().trim().max(200).optional(),
    dryRun: z.boolean().default(false),
    /** Only for reports: the category the admin was looking for. */
    categoryId: z.uuid().optional(),
    /** Set on jobs created from a preview job. */
    fromJobId: z.uuid().optional(),
    /** Scheduled re-sync of already imported records. */
    sync: z.boolean().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.mode === "search" && (!q.text || q.text.length < 2))
      ctx.addIssue({ code: "custom", path: ["text"], message: "Enter at least 2 characters" });
    if (q.mode !== "search" && q.values.length === 0)
      ctx.addIssue({ code: "custom", path: ["values"], message: "Enter at least one value" });
  });
export type JobQuery = z.infer<typeof jobQuerySchema>;

export interface EnqueueInput {
  provider: ProviderKey;
  query: z.input<typeof jobQuerySchema>;
  /** Hard cap on items for this job (≤ IMPORT_JOB_MAX_ITEMS). */
  maxItems?: number;
}

function dedupeKey(provider: string, q: JobQuery, keys: string[]): string {
  const what = q.mode === "search" ? q.text!.toLowerCase() : [...keys].sort().join(",");
  return `${provider}:${q.mode}:${q.dryRun ? "preview" : "import"}:${createHash("sha256").update(what).digest("hex").slice(0, 32)}`;
}

/**
 * Queues a provider job. Refuses unless the provider is runnable (adapter, configuration, enabled)
 * and its source's licence was confirmed (usage permitted). The same job cannot be queued twice
 * while one is queued or running (unique dedupe key).
 */
export async function enqueueProviderJob(
  ctx: ServiceContext,
  env: Env,
  input: EnqueueInput,
): Promise<ImportJob> {
  const query = parseOrThrow(jobQuerySchema, input.query, "Invalid import request");
  const availability = await providerAvailability(ctx.db, input.provider, env);
  if (!availability.runnable)
    throw new InvalidStateError(
      availability.reason === "no_adapter"
        ? `${input.provider} has no adapter yet`
        : availability.reason === "not_configured"
          ? `${input.provider} is not configured (${availability.missing?.join(", ")})`
          : `${input.provider} is switched off`,
    );
  const adapter = availability.adapter;
  if (query.mode === "gtin" && !adapter.capabilities.lookupByGtin)
    throw new ValidationError(`${adapter.displayName} cannot look up GTINs`);
  if (query.mode === "search" && !adapter.capabilities.search)
    throw new ValidationError(`${adapter.displayName} has no search`);
  if (query.mode === "ids" && !adapter.capabilities.fetchById)
    throw new ValidationError(`${adapter.displayName} cannot fetch records by ID`);

  let keys = query.values;
  if (query.mode === "gtin") {
    const { valid, invalid } = partitionGtins(query.values);
    if (invalid.length)
      throw new ValidationError(
        `Invalid GTINs: ${invalid.map((i) => `${i.raw} (${i.reason.replace(/_/g, " ")})`).join(", ")}`,
        [{ path: "values", message: "Check the GTINs" }],
      );
    keys = valid;
  }
  keys = [...new Set(keys)];
  const maxItems = Math.min(input.maxItems ?? env.IMPORT_JOB_MAX_ITEMS, env.IMPORT_JOB_MAX_ITEMS);
  if (maxItems < 1) throw new ValidationError("The item cap must be at least 1");
  if (keys.length > maxItems)
    throw new ValidationError(
      `${keys.length} items exceed this job's cap of ${maxItems}; split the list or raise the cap`,
    );

  const source = await ensureProviderSource(ctx, adapter);
  if (!source.usagePermitted)
    throw new InvalidStateError(
      `Confirm the licence of “${source.sourceName}” on the Sources page (usage permitted) before importing`,
    );

  return inTransaction(ctx, async (tx) => {
    const key = dedupeKey(input.provider, query, keys);
    const [job] = await tx
      .insert(importJobs)
      .values({
        sourceId: source.id,
        importType: "products",
        kind: "provider",
        provider: input.provider,
        query,
        caps: { maxItems },
        checkpoint: {},
        dedupeKey: key,
        status: "queued",
        totalRows: keys.length,
        createdBy: ctx.actorId,
      })
      .onConflictDoNothing()
      .returning();
    if (!job) throw new ConflictError("The same import is already queued or running");
    if (keys.length)
      await tx
        .insert(importJobItems)
        .values(keys.map((k, i) => ({ jobId: job.id, seq: i + 1, externalKey: k })));
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "import_job",
      entityId: job.id,
      action: query.dryRun ? "queue_preview" : "queue_import",
      next: { provider: input.provider, query, maxItems },
    });
    return job;
  });
}

/** Queued jobs stop at once; running jobs stop after the current item. */
export async function cancelJob(ctx: ServiceContext, jobId: string): Promise<ImportJob> {
  return inTransaction(ctx, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).for("update");
    if (!job || job.kind !== "provider") throw new NotFoundError("Import job", jobId);
    if (job.status !== "queued" && job.status !== "running")
      throw new InvalidStateError("Only queued or running jobs can be cancelled");
    const [row] = await tx
      .update(importJobs)
      .set(
        job.status === "queued"
          ? { status: "cancelled", completedAt: new Date(), cancelRequestedAt: new Date() }
          : { cancelRequestedAt: new Date() },
      )
      .where(eq(importJobs.id, jobId))
      .returning();
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "import_job",
      entityId: jobId,
      action: "cancel",
      previous: job,
      next: row,
    });
    return row!;
  });
}

/** Re-queues only the failed items of a finished job; items already applied are not touched. */
export async function retryFailedItems(ctx: ServiceContext, jobId: string): Promise<number> {
  return inTransaction(ctx, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).for("update");
    if (!job || job.kind !== "provider") throw new NotFoundError("Import job", jobId);
    if (job.status === "queued" || job.status === "running")
      throw new InvalidStateError("Wait until the job has stopped");
    const reset = await tx
      .update(importJobItems)
      .set({ status: "pending", attempts: 0, error: null })
      .where(and(eq(importJobItems.jobId, jobId), eq(importJobItems.status, "failed")))
      .returning({ id: importJobItems.id });
    if (reset.length === 0) throw new InvalidStateError("No failed items to retry");
    await tx
      .update(importJobs)
      .set({
        status: "queued",
        runAfter: new Date(),
        completedAt: null,
        cancelRequestedAt: null,
        lastError: null,
        lockedBy: null,
        lockedUntil: null,
      })
      .where(eq(importJobs.id, jobId));
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "import_job",
      entityId: jobId,
      action: "retry_failed",
      next: { items: reset.length },
    });
    return reset.length;
  });
}

export interface JobSummary extends ImportJob {
  counts: Record<string, number>;
}

/** Recent provider jobs with item counts by status (discovered = all items). */
export async function listProviderJobs(db: DbOrTx, limit = 50): Promise<JobSummary[]> {
  const jobs = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.kind, "provider"))
    .orderBy(desc(importJobs.createdAt))
    .limit(Math.min(limit, 200));
  if (jobs.length === 0) return [];
  const rows = await db.execute<{ job_id: string; status: string; n: number }>(sql`
    SELECT job_id, status, count(*)::int AS n FROM import_job_items
    WHERE job_id = ANY(${sql.param(jobs.map((j) => j.id))}::uuid[]) GROUP BY 1, 2`);
  return jobs.map((j) => ({
    ...j,
    counts: Object.fromEntries(
      rows.filter((r) => r.job_id === j.id).map((r) => [r.status, Number(r.n)]),
    ),
  }));
}

export async function getProviderJob(db: DbOrTx, jobId: string) {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  if (!job || job.kind !== "provider") return null;
  const items = await db
    .select()
    .from(importJobItems)
    .where(eq(importJobItems.jobId, jobId))
    .orderBy(importJobItems.seq)
    .limit(2000);
  return { job, items };
}

/**
 * Queues re-sync jobs for records not seen for `olderThanDays` (scheduled sync). Uses the same
 * caps, quotas and dedupe as manual imports; returns the job or null when nothing is due.
 */
export async function enqueueSyncJob(
  ctx: ServiceContext,
  env: Env,
  provider: ProviderKey,
  olderThanDays: number,
): Promise<ImportJob | null> {
  const due = await ctx.db.execute<{ id: string }>(sql`
    SELECT r.provider_product_id AS id FROM product_source_records r
    JOIN sources s ON s.id = r.source_id AND s.provider_key = ${provider}
    WHERE r.provider_product_id IS NOT NULL
      AND (r.last_seen_at IS NULL OR r.last_seen_at < now() - make_interval(days => ${olderThanDays}))
    ORDER BY r.last_seen_at NULLS FIRST
    LIMIT ${env.IMPORT_JOB_MAX_ITEMS}`);
  if (due.length === 0) return null;
  try {
    return await enqueueProviderJob(ctx, env, {
      provider,
      query: { mode: "ids", values: due.map((d) => d.id), sync: true },
    });
  } catch (e) {
    if (e instanceof ConflictError) return null; // a sync is already queued
    throw e;
  }
}
