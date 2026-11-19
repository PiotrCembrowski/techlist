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
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { products, productVariants, sources } from "./catalog";
import {
  adminRole,
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

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    importType: importType().notNull(),
    fileName: text().notNull(),
    fileChecksum: text().notNull(),
    columnMapping: jsonb().$type<Record<string, string>>().notNull().default({}),
    status: importStatus().notNull().default("uploaded"),
    totalRows: integer().notNull().default(0),
    successfulRows: integer().notNull().default(0),
    failedRows: integer().notNull().default(0),
    skippedRows: integer().notNull().default(0),
    createdBy: uuid().references(() => adminUsers.id, { onDelete: "set null" }),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_jobs_created_idx").on(t.createdAt.desc())],
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
