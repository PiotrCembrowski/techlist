import { createHash } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { importJobs, importRows, sources } from "@/db/schema";
import { CsvError, decodeUtf8, parseCsv, toRecords, unguardCell, writeCsv } from "@/lib/csv";
import type { DbOrTx } from "@/lib/db";
import { PostgresRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import {
  InvalidStateError,
  NotFoundError,
  ServiceError,
  ValidationError,
} from "@/modules/_shared/errors";
import { createReviewItem } from "@/modules/review-queue/service";
import { applyMapping, autoMap, baseColumns, checkMapping, type ImportType } from "./columns";
import { applyOfferPlan, parseOfferRow, planOfferRows, type OfferRowPlan } from "./offers";
import {
  applyProductPlan,
  parseProductRow,
  planProductRows,
  type ApplyState,
  type ProductRowPlan,
} from "./products";
import type { RowAction } from "./types";

export type ImportJob = typeof importJobs.$inferSelect;

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;
/** SPEC §13: imports are rate limited (per admin). */
export const IMPORT_LIMIT = 20;
export const IMPORT_WINDOW_SECONDS = 60 * 60;
const COMMIT_BATCH = 100;
/** A commit that has not finished a batch for this long is considered abandoned. */
export const STALE_COMMIT_MINUTES = 15;
const UPDATE_CHUNK = 500;

const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

/** Stable hash of a row's mapped content (order-independent, trimmed). */
export function rowHash(type: ImportType, mapped: Record<string, string>): string {
  const entries = Object.entries(mapped)
    .map(([k, v]) => [k, v.trim()] as const)
    .filter(([, v]) => v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return sha256(`${type}\n${JSON.stringify(entries)}`);
}

async function permittedSource(db: DbOrTx, sourceId: string) {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source)
    throw new ValidationError("Choose a source", [
      { path: "sourceId", message: "Choose a source" },
    ]);
  if (!source.usagePermitted) {
    throw new ValidationError(
      `"${source.sourceName}" does not permit use of its data (rule 2.1.9)`,
      [{ path: "sourceId", message: "This source does not permit use of its data" }],
    );
  }
  return source;
}

// ─── Upload ────────────────────────────────────────────────────────────────────────────

/**
 * Step 2 (upload): checks the file (.csv, ≤ 5 MB, UTF-8, ≤ 10,000 rows), stores every row raw
 * in `import_rows` and proposes a column mapping. Nothing in the catalogue changes.
 */
export async function createImportJob(
  ctx: ServiceContext,
  input: { importType: ImportType; sourceId: string; file: File | null },
): Promise<ImportJob> {
  const { file } = input;
  if (input.importType !== "products" && input.importType !== "offers")
    throw new ValidationError("Unknown import type");
  if (!file || file.size === 0)
    throw new ValidationError("Choose a CSV file", [
      { path: "file", message: "Choose a CSV file" },
    ]);
  if (!/\.csv$/i.test(file.name))
    throw new ValidationError("Only .csv files are accepted", [
      { path: "file", message: "Only .csv files are accepted" },
    ]);
  if (file.size > MAX_IMPORT_BYTES)
    throw new ValidationError("CSV files must be 5 MB or smaller", [
      { path: "file", message: "CSV files must be 5 MB or smaller" },
    ]);
  const source = await permittedSource(ctx.db, input.sourceId);
  const limit = await new PostgresRateLimiter(ctx.db).consume(
    rateLimitKey("import", ctx.actorId ?? "system"),
    IMPORT_LIMIT,
    IMPORT_WINDOW_SECONDS,
  );
  if (!limit.allowed)
    throw new ValidationError(`Too many imports — at most ${IMPORT_LIMIT} per hour`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  let headers: string[];
  let records: Record<string, string>[];
  try {
    if (bytes.includes(0)) throw new CsvError("The file contains binary data");
    ({ headers, records } = toRecords(parseCsv(decodeUtf8(bytes), { maxRows: MAX_IMPORT_ROWS })));
  } catch (e) {
    if (e instanceof CsvError)
      throw new ValidationError(e.message, [{ path: "file", message: e.message }]);
    throw e;
  }
  if (records.length === 0)
    throw new ValidationError("The file has no data rows", [
      { path: "file", message: "The file has no data rows" },
    ]);
  // Exported files guard formula-like cells with a leading apostrophe; undo that here.
  records = records.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, unguardCell(v)])),
  );

  const specKeys = input.importType === "products" ? await allSpecKeys(ctx.db) : [];
  const mapping = autoMap(input.importType, headers, specKeys);

  return inTransaction(ctx, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        sourceId: source.id,
        importType: input.importType,
        fileName: file.name.slice(0, 200),
        fileChecksum: sha256(bytes),
        columnMapping: mapping,
        totalRows: records.length,
        createdBy: ctx.actorId,
      })
      .returning();
    for (let i = 0; i < records.length; i += 1000) {
      await tx.insert(importRows).values(
        records.slice(i, i + 1000).map((raw, j) => ({
          jobId: job!.id,
          rowNumber: i + j + 2, // header is row 1
          raw,
          rowHash: rowHash(input.importType, raw),
        })),
      );
    }
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "import_job",
      entityId: job!.id,
      action: "upload",
      next: {
        fileName: job!.fileName,
        importType: job!.importType,
        totalRows: job!.totalRows,
        fileChecksum: job!.fileChecksum,
      },
    });
    return job!;
  });
}

async function allSpecKeys(db: DbOrTx): Promise<string[]> {
  const rows = await db.execute<{ key: string }>(
    sql`SELECT DISTINCT key FROM specification_definitions LIMIT 2000`,
  );
  return rows.map((r) => r.key);
}

/** Headers of the uploaded file, in template order (mapped first), then unmapped alphabetically. */
export function orderedHeaders(job: Pick<ImportJob, "importType" | "columnMapping">): string[] {
  const base = baseColumns(job.importType);
  const rank = (h: string) => {
    const t = job.columnMapping[h] ?? "";
    if (!t) return 10_000;
    const i = base.indexOf(t);
    return i >= 0 ? i : 1000;
  };
  return Object.keys(job.columnMapping).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// ─── Mapping ───────────────────────────────────────────────────────────────────────────

export async function setImportMapping(
  ctx: ServiceContext,
  jobId: string,
  mapping: Record<string, string>,
): Promise<ImportJob> {
  return inTransaction(ctx, async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status !== "uploaded" && job.status !== "validated")
      throw new InvalidStateError("This import can no longer be changed");
    const headers = new Set(Object.keys(job.columnMapping));
    const clean: Record<string, string> = {};
    for (const h of headers) clean[h] = (mapping[h] ?? "").trim();
    const errors = checkMapping(job.importType, clean);
    if (errors.length) throw new ValidationError(errors.join(". "));
    const [row] = await tx
      .update(importJobs)
      .set({ columnMapping: clean, status: "uploaded" })
      .where(eq(importJobs.id, jobId))
      .returning();
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "import_job",
      entityId: jobId,
      action: "map",
      previous: { columnMapping: job.columnMapping },
      next: { columnMapping: clean },
    });
    return row!;
  });
}

async function lockJob(db: DbOrTx, jobId: string): Promise<ImportJob> {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).for("update");
  if (!job) throw new NotFoundError("Import", jobId);
  return job;
}

// ─── Validate (steps 4–7) ──────────────────────────────────────────────────────────────

type AnyPlan = ProductRowPlan | OfferRowPlan;

async function planJob(db: DbOrTx, job: ImportJob) {
  const rows = await db
    .select({ id: importRows.id, rowNumber: importRows.rowNumber, raw: importRows.raw })
    .from(importRows)
    .where(eq(importRows.jobId, job.id))
    .orderBy(importRows.rowNumber)
    .limit(MAX_IMPORT_ROWS);
  const [source] = await db.select().from(sources).where(eq(sources.id, job.sourceId));
  if (!source?.usagePermitted)
    throw new ValidationError("The import's source no longer permits use of its data");
  const prepared = rows.map((r, idx) => {
    const mapped = applyMapping(r.raw, job.columnMapping);
    const hash = rowHash(job.importType, mapped);
    const parsed = job.importType === "products" ? parseProductRow(mapped) : parseOfferRow(mapped);
    return { ...r, idx, mapped, hash, ...parsed };
  });
  const plans: AnyPlan[] =
    job.importType === "products"
      ? await planProductRows(db, prepared as never, source)
      : await planOfferRows(db, prepared as never, source);
  return { rows: prepared, plans, source };
}

function rowUpdate(row: { id: string; hash: string }, plan: AnyPlan) {
  const p = plan as ProductRowPlan & OfferRowPlan;
  return {
    id: row.id,
    row_hash: row.hash,
    action: plan.action,
    errors: plan.issues,
    normalized: { data: plan.data, notes: plan.notes, conflict: p.conflict ?? null },
    matched_product_id: (p.productId ?? (p.values?.productId as string | undefined)) || null,
    matched_variant_id: (p.variantId ?? (p.values?.variantId as string | undefined)) || null,
  };
}

async function writeRowResults(db: DbOrTx, updates: ReturnType<typeof rowUpdate>[]) {
  for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
    const chunk = JSON.stringify(updates.slice(i, i + UPDATE_CHUNK));
    await db.execute(sql`
      UPDATE import_rows r SET row_hash = x.row_hash, action = x.action::import_row_action, errors = x.errors,
             normalized = x.normalized, matched_product_id = x.matched_product_id, matched_variant_id = x.matched_variant_id
      FROM jsonb_to_recordset(${chunk}::jsonb) AS x(id uuid, row_hash text, action text, errors jsonb, normalized jsonb,
                                                   matched_product_id uuid, matched_variant_id uuid)
      WHERE r.id = x.id`);
  }
}

/**
 * Validates every row (Zod + references + duplicate detection) and records what committing would
 * do. Read-only for the catalogue; can be run again after changing the mapping.
 */
export async function validateImportJob(ctx: ServiceContext, jobId: string): Promise<ImportJob> {
  return inTransaction(ctx, async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status !== "uploaded" && job.status !== "validated")
      throw new InvalidStateError("This import can no longer be validated");
    const errors = checkMapping(job.importType, job.columnMapping);
    if (errors.length) throw new ValidationError(errors.join(". "));
    const { rows, plans } = await planJob(tx, job);
    await writeRowResults(
      tx,
      rows.map((r, i) => rowUpdate(r, plans[i]!)),
    );
    const counts = countActions(plans.map((p) => p.action));
    const [row] = await tx
      .update(importJobs)
      .set({
        status: "validated",
        successfulRows: 0,
        failedRows: counts.error + counts.conflict,
        skippedRows: counts.skip,
      })
      .where(eq(importJobs.id, jobId))
      .returning();
    return row!;
  });
}

function countActions(actions: RowAction[]) {
  const c: Record<RowAction, number> = { create: 0, update: 0, skip: 0, conflict: 0, error: 0 };
  for (const a of actions) c[a]++;
  return c;
}

// ─── Commit (step 8) ───────────────────────────────────────────────────────────────────

export interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  conflicts: number;
  errors: number;
  reviewItems: number;
}

/**
 * Commits the valid rows in batched transactions (each row in its own savepoint, so one bad row
 * never undoes the others). The plan is recomputed first, so the result reflects the catalogue
 * at commit time. Conflicts become review items; nothing is merged on similarity alone.
 */
export async function commitImportJob(ctx: ServiceContext, jobId: string): Promise<CommitResult> {
  // Claim the job so two commits cannot run at once. A claim with no progress for
  // STALE_COMMIT_MINUTES (e.g. the request was killed by a host timeout) can be taken over: the
  // plan is recomputed, so rows that were already applied become no-ops.
  const [claimed] = await ctx.db
    .update(importJobs)
    .set({ startedAt: new Date() })
    .where(
      and(
        eq(importJobs.id, jobId),
        eq(importJobs.status, "validated"),
        sql`(${importJobs.startedAt} IS NULL OR ${importJobs.startedAt} < now() - make_interval(mins => ${STALE_COMMIT_MINUTES}))`,
      ),
    )
    .returning();
  if (!claimed) {
    const [job] = await ctx.db
      .select({ status: importJobs.status })
      .from(importJobs)
      .where(eq(importJobs.id, jobId));
    if (!job) throw new NotFoundError("Import", jobId);
    throw new InvalidStateError(
      job.status === "validated"
        ? "This import is already being committed"
        : "Validate the import before committing it",
    );
  }
  try {
    const { rows, plans } = await planJob(ctx.db, claimed);
    const result: CommitResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
      reviewItems: 0,
    };
    const state: ApplyState = { created: new Map() };
    const updates: ReturnType<typeof rowUpdate>[] = [];

    for (let i = 0; i < rows.length; i += COMMIT_BATCH) {
      await ctx.db.transaction(async (tx) => {
        for (let j = i; j < Math.min(i + COMMIT_BATCH, rows.length); j++) {
          const row = rows[j]!;
          const plan = plans[j]!;
          if (plan.action === "create" || plan.action === "update") {
            try {
              await tx.transaction(async (sp) => {
                const rctx = { db: sp, actorId: ctx.actorId };
                if (claimed.importType === "products") {
                  const r = await applyProductPlan(rctx, plan as ProductRowPlan, state);
                  (plan as ProductRowPlan).productId ??= r.productId;
                  (plan as ProductRowPlan).variantId ??= r.variantId;
                  result.reviewItems += r.reviewItems;
                } else {
                  const r = await applyOfferPlan(rctx, plan as OfferRowPlan);
                  if (r.suspicious) result.reviewItems++;
                }
              });
              result[plan.action === "create" ? "created" : "updated"]++;
            } catch (e) {
              // Expected, row-level failures only; anything else aborts the commit.
              if (!(e instanceof ServiceError)) throw e;
              plan.action = "error";
              plan.issues.push({ message: e.message });
              result.errors++;
            }
          } else if (plan.action === "conflict") {
            const c = (plan as ProductRowPlan).conflict;
            if (c) {
              await createReviewItem(tx, {
                itemType: c.type,
                entityType: "import_row",
                entityId: row.id,
                createdBy: ctx.actorId,
                payload: {
                  jobId,
                  rowId: row.id,
                  rowNumber: row.rowNumber,
                  rowHash: row.hash,
                  reason: c.reason,
                  candidates: c.candidates,
                  row: plan.data,
                },
              });
              result.reviewItems++;
            }
            result.conflicts++;
          } else if (plan.action === "skip") result.skipped++;
          else result.errors++;
          updates.push(rowUpdate(row, plan));
        }
      });
      // Heartbeat: a commit that keeps finishing batches is never treated as abandoned.
      await ctx.db
        .update(importJobs)
        .set({ startedAt: new Date() })
        .where(eq(importJobs.id, jobId));
    }

    await ctx.db.transaction(async (tx) => {
      await writeRowResults(tx, updates);
      await tx
        .update(importJobs)
        .set({
          status: "committed",
          successfulRows: result.created + result.updated,
          failedRows: result.errors + result.conflicts,
          skippedRows: result.skipped,
          completedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId));
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "import_job",
        entityId: jobId,
        action: "commit",
        next: result,
      });
    });
    return result;
  } catch (e) {
    await ctx.db.update(importJobs).set({ startedAt: null }).where(eq(importJobs.id, jobId));
    throw e;
  }
}

export async function cancelImportJob(ctx: ServiceContext, jobId: string): Promise<void> {
  await inTransaction(ctx, async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status !== "uploaded" && job.status !== "validated")
      throw new InvalidStateError("Only imports that are not committed can be cancelled");
    if (job.startedAt && Date.now() - job.startedAt.getTime() < STALE_COMMIT_MINUTES * 60_000) {
      throw new InvalidStateError("This import is being committed");
    }
    await tx
      .update(importJobs)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(importJobs.id, jobId));
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "import_job",
      entityId: jobId,
      action: "cancel",
    });
  });
}

// ─── Reads ─────────────────────────────────────────────────────────────────────────────

export async function getImportJob(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ job: importJobs, sourceName: sources.sourceName })
    .from(importJobs)
    .innerJoin(sources, eq(sources.id, importJobs.sourceId))
    .where(eq(importJobs.id, id));
  return row ?? null;
}

export async function listImportJobs(db: DbOrTx, page = 1) {
  const pageSize = 25;
  const rows = await db
    .select({ job: importJobs, sourceName: sources.sourceName })
    .from(importJobs)
    .innerJoin(sources, eq(sources.id, importJobs.sourceId))
    .orderBy(desc(importJobs.createdAt))
    .limit(pageSize + 1)
    .offset((Math.max(1, page) - 1) * pageSize);
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}

export async function countImportRows(db: DbOrTx, jobId: string) {
  const rows = await db
    .select({ action: importRows.action, n: count() })
    .from(importRows)
    .where(eq(importRows.jobId, jobId))
    .groupBy(importRows.action);
  const c: Record<RowAction, number> = { create: 0, update: 0, skip: 0, conflict: 0, error: 0 };
  for (const r of rows) if (r.action) c[r.action] = Number(r.n);
  return c;
}

export async function listImportRows(
  db: DbOrTx,
  jobId: string,
  opts: { action?: RowAction | null; page?: number } = {},
) {
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  const rows = await db
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.jobId, jobId),
        opts.action ? eq(importRows.action, opts.action) : undefined,
      ),
    )
    .orderBy(importRows.rowNumber)
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { items: rows.slice(0, pageSize), page, hasNext: rows.length > pageSize };
}

/** Step 10: rows with errors or conflicts, with the original cells, as CSV (formula-guarded). */
export async function importErrorReportCsv(
  db: DbOrTx,
  jobId: string,
): Promise<{ fileName: string; csv: string }> {
  const found = await getImportJob(db, jobId);
  if (!found) throw new NotFoundError("Import", jobId);
  const { job } = found;
  const rows = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.jobId, jobId), sql`${importRows.action} IN ('error', 'conflict')`))
    .orderBy(importRows.rowNumber)
    .limit(MAX_IMPORT_ROWS);
  const headers = orderedHeaders(job);
  const out: (string | number)[][] = [["row_number", "action", "problems", ...headers]];
  for (const r of rows) {
    const notes = ((r.normalized as { notes?: string[] } | null)?.notes ?? []).join("; ");
    const problems = [
      ...r.errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)),
      r.action === "conflict" ? notes : "",
    ]
      .filter(Boolean)
      .join("; ");
    out.push([r.rowNumber, r.action ?? "", problems, ...headers.map((h) => r.raw[h] ?? "")]);
  }
  const base =
    (job.fileName ?? "import")
      .replace(/\.csv$/i, "")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 80) || "import";
  return { fileName: `${base}-errors.csv`, csv: writeCsv(out) };
}
