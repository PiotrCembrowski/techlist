import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { products, productVariants, sources } from "./catalog";
import {
  adminRole,
  importJobKind,
  importRowAction,
  importStatus,
  importType,
  reviewItemType,
  reviewStatus,
} from "./enums";

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull().unique(),
    name: text().notNull(),
    passwordHash: text().notNull(),
    role: adminRole().notNull().default("editor"),
    isActive: boolean().notNull().default(true),
    lastLoginAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [check("admin_users_email_lower_ck", sql`${t.email} = lower(${t.email})`)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** NULL for system actions (CLI scripts, migrations of data). */
    adminUserId: uuid().references((): AnyPgColumn => adminUsers.id, { onDelete: "set null" }),
    entityType: text().notNull(),
    entityId: uuid(),
    action: text().notNull(),
    previousData: jsonb(),
    newData: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt.desc()),
    index("audit_logs_created_idx").on(t.createdAt.desc()),
  ],
);

/**
 * "queued or running", written with the older enum values only: Postgres refuses a value added by
 * ALTER TYPE in the same transaction (migration 0008), and an enum→text cast is not immutable.
 */
const ACTIVE_JOB = sql.raw(
  `"import_jobs"."status" NOT IN ('uploaded', 'validated', 'committed', 'failed', 'cancelled')`,
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    importType: importType().notNull(),
    /** `csv`: an uploaded file (admin request); `provider`: a provider job run by the worker. */
    kind: importJobKind().notNull().default("csv"),
    fileName: text(),
    fileChecksum: text(),
    columnMapping: jsonb().$type<Record<string, string>>().notNull().default({}),
    status: importStatus().notNull().default("uploaded"),
    totalRows: integer().notNull().default(0),
    successfulRows: integer().notNull().default(0),
    failedRows: integer().notNull().default(0),
    skippedRows: integer().notNull().default(0),
    createdBy: uuid().references(() => adminUsers.id, { onDelete: "set null" }),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    // ── Provider jobs (kind = provider) ──
    /** Adapter key, e.g. `icecat`. */
    provider: text(),
    /** What to fetch: { mode: "gtin" | "search" | "sync", values / query, categoryId, … }. */
    query: jsonb().$type<Record<string, unknown>>(),
    /** Caps for this job: { maxItems, maxRequests, maxMinutes }. */
    caps: jsonb().$type<Record<string, number>>(),
    /** Where to resume after a crash or a time-boxed run. */
    checkpoint: jsonb().$type<Record<string, unknown>>(),
    /** Prevents queuing the same job twice while one is queued or running. */
    dedupeKey: text(),
    attempts: integer().notNull().default(0),
    /** Earliest time the worker may (re)start the job (backoff after a failure). */
    runAfter: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Worker lease: the job is owned by lockedBy until lockedUntil; an expired lease can be taken over. */
    lockedBy: text(),
    lockedUntil: timestamp({ withTimezone: true }),
    cancelRequestedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("import_jobs_created_idx").on(t.createdAt.desc()),
    index("import_jobs_runnable_idx")
      .on(t.runAfter)
      .where(sql`${t.kind} = 'provider' AND ${ACTIVE_JOB}`),
    uniqueIndex("import_jobs_dedupe_uq")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL AND ${ACTIVE_JOB}`),
    check(
      "import_jobs_kind_ck",
      sql`CASE ${t.kind} WHEN 'csv' THEN ${t.fileName} IS NOT NULL AND ${t.fileChecksum} IS NOT NULL
          ELSE ${t.provider} IS NOT NULL AND ${t.query} IS NOT NULL END`,
    ),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    rowNumber: integer().notNull(),
    raw: jsonb().$type<Record<string, string>>().notNull(),
    normalized: jsonb(),
    rowHash: text().notNull(),
    action: importRowAction(),
    errors: jsonb().$type<{ field?: string; message: string }[]>().notNull().default([]),
    matchedProductId: uuid().references(() => products.id, { onDelete: "set null" }),
    matchedVariantId: uuid().references(() => productVariants.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("import_rows_job_row_uq").on(t.jobId, t.rowNumber),
    index("import_rows_hash_idx").on(t.rowHash),
    index("import_rows_job_action_idx").on(t.jobId, t.action),
  ],
);

export const reviewItems = pgTable(
  "review_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    itemType: reviewItemType().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: reviewStatus().notNull().default("open"),
    createdBy: uuid().references(() => adminUsers.id, { onDelete: "set null" }),
    resolvedBy: uuid().references(() => adminUsers.id, { onDelete: "set null" }),
    resolvedAt: timestamp({ withTimezone: true }),
    resolutionNote: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_items_open_idx").on(t.status, t.itemType, t.createdAt.desc()),
    index("review_items_entity_idx").on(t.entityType, t.entityId),
    check("review_items_resolution_ck", sql`(${t.status} = 'open') = (${t.resolvedAt} IS NULL)`),
  ],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index("rate_limits_window_idx").on(t.windowStart),
  ],
);
