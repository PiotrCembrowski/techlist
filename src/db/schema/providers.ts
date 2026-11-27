import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import {
  brands,
  categories,
  products,
  productVariants,
  sources,
  specificationDefinitions,
} from "./catalog";
import { identifierType, importJobItemStatus, providerMappingType } from "./enums";
import { adminUsers, importJobs } from "./operations";

/** Provider adapter keys are short snake_case words (`icecat`, `wikidata`, `upcitemdb`, `ebay`). */
const PROVIDER_CHECK = (col: unknown) => sql`${col} ~ '^[a-z][a-z0-9_]{1,31}$'`;

// ─── Identity ──────────────────────────────────────────────────────────────────────────

/**
 * Every identifier that points at exactly one product or variant (DECISIONS D78). Matching uses
 * these first: GTIN → MPN + brand → model number + brand. GTINs are stored as GTIN-14.
 */
export const productIdentifiers = pgTable(
  "product_identifiers",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, { onDelete: "cascade" }),
    identifierType: identifierType().notNull(),
    /** Normalised: GTIN-14 digits; MPN / model number upper-cased with collapsed spaces. */
    value: text().notNull(),
    /** As the source wrote it. */
    rawValue: text(),
    /** Set for provider_product_id (which provider's ID it is). */
    provider: text(),
    sourceId: uuid().references(() => sources.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("product_identifiers_uq")
      .on(t.productId, t.variantId, t.identifierType, t.provider, t.value)
      .nullsNotDistinct(),
    // A GTIN identifies one trade item in the whole catalogue.
    uniqueIndex("product_identifiers_gtin_uq")
      .on(t.value)
      .where(sql`${t.identifierType} = 'gtin'`),
    // A provider's product ID maps to one record.
    uniqueIndex("product_identifiers_provider_uq")
      .on(t.provider, t.value)
      .where(sql`${t.identifierType} = 'provider_product_id'`),
    index("product_identifiers_lookup_idx").on(t.identifierType, t.value),
    index("product_identifiers_product_idx").on(t.productId),
    check(
      "product_identifiers_gtin_ck",
      sql`${t.identifierType} <> 'gtin' OR ${t.value} ~ '^[0-9]{14}$'`,
    ),
    check(
      "product_identifiers_provider_ck",
      sql`(${t.identifierType} = 'provider_product_id') = (${t.provider} IS NOT NULL)
          AND (${t.provider} IS NULL OR ${PROVIDER_CHECK(t.provider)})`,
    ),
    check("product_identifiers_value_ck", sql`length(${t.value}) BETWEEN 1 AND 200`),
  ],
);

/**
 * Field-level provenance: which source supplied the current value of a product/variant field
 * (`name`, `release_date`, `spec:<key>`, `image:<id>`, …) and what it said. Never overwritten by a
 * sync when the field's value was verified by an editor (enforced in the import service).
 */
export const fieldProvenance = pgTable(
  "field_provenance",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, { onDelete: "cascade" }),
    field: text().notNull(),
    /** NULL only for a manual value (`isManual`): an admin edited or entered it by hand. */
    sourceId: uuid().references(() => sources.id, { onDelete: "restrict" }),
    isManual: boolean().notNull().default(false),
    adminUserId: uuid().references(() => adminUsers.id, { onDelete: "set null" }),
    provider: text(),
    providerProductId: text(),
    /** The source's value before normalisation (JSON: string, number, object). */
    rawValue: jsonb(),
    /** sha256 of the normalised value; detects changes on re-sync. */
    valueHash: text().notNull(),
    retrievedAt: timestamp({ withTimezone: true }).notNull(),
    confidence: numeric({ precision: 4, scale: 3, mode: "number" }),
    /** True when this source's value is the one currently stored on the product. */
    isCurrent: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("field_provenance_uq")
      .on(t.productId, t.variantId, t.field, t.sourceId)
      .nullsNotDistinct(),
    index("field_provenance_product_idx").on(t.productId, t.field),
    check(
      "field_provenance_origin_ck",
      sql`(${t.sourceId} IS NOT NULL AND NOT ${t.isManual}) OR (${t.sourceId} IS NULL AND ${t.isManual})`,
    ),
    check("field_provenance_field_ck", sql`${t.field} ~ '^[a-z][a-z0-9_]*(:[a-z0-9_.-]+)?$'`),
    check("field_provenance_hash_ck", sql`${t.valueHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "field_provenance_confidence_ck",
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
    ),
  ],
);

// ─── Provider operations ───────────────────────────────────────────────────────────────

/**
 * Admin switches per provider. Credentials are never stored here (env only); `config` holds
 * non-secret options. A provider runs only when it is enabled here AND configured in env.
 */
export const providerSettings = pgTable(
  "provider_settings",
  {
    provider: text().primaryKey(),
    enabled: boolean().notNull().default(false),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    lastHealthStatus: text().notNull().default("unknown"),
    lastHealthCheckedAt: timestamp({ withTimezone: true }),
    lastHealthMessage: text(),
    updatedBy: uuid().references(() => adminUsers.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    check("provider_settings_provider_ck", PROVIDER_CHECK(t.provider)),
    check(
      "provider_settings_health_ck",
      sql`${t.lastHealthStatus} IN ('unknown', 'ok', 'degraded', 'error', 'not_configured')`,
    ),
  ],
);

/**
 * Quota ledger: calls reserved per provider, bucket (`requests`, `searches`, …) and window. A call
 * reserves its unit BEFORE it is made, in one atomic statement that refuses to exceed the limit.
 */
export const providerQuotaUsage = pgTable(
  "provider_quota_usage",
  {
    provider: text().notNull(),
    bucket: text().notNull(),
    /** Start of the window (UTC), e.g. midnight for a daily limit. */
    windowStart: timestamp({ withTimezone: true }).notNull(),
    windowSeconds: integer().notNull(),
    used: integer().notNull().default(0),
    /** The limit in force when the window was opened (for reports). */
    limitValue: integer().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.bucket, t.windowStart] }),
    index("provider_quota_usage_window_idx").on(t.windowStart),
    check("provider_quota_usage_used_ck", sql`${t.used} >= 0 AND ${t.used} <= ${t.limitValue}`),
    check("provider_quota_usage_window_ck", sql`${t.windowSeconds} > 0`),
  ],
);

/**
 * Raw provider responses, so re-processing (new mappings, a bug fix) needs no new API call. Keyed
 * by provider + a hash of the request without credentials. Bodies are capped by the HTTP client.
 */
export const providerResponseCache = pgTable(
  "provider_response_cache",
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: text().notNull(),
    /** sha256 of method + URL (credentials removed) + body. */
    requestKey: text().notNull(),
    /** URL with credentials removed, for debugging. */
    requestUrl: text().notNull(),
    httpStatus: integer().notNull(),
    contentType: text(),
    body: text().notNull(),
    bodyHash: text().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique("provider_response_cache_uq").on(t.provider, t.requestKey),
    index("provider_response_cache_expires_idx").on(t.expiresAt),
    check("provider_response_cache_key_ck", sql`${t.requestKey} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * How a provider's categories, features (spec fields) and brands map to ours. Unmapped provider
 * features are reported, never guessed. `transform` holds unit conversion rules for features.
 */
export const providerMappings = pgTable(
  "provider_mappings",
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: text().notNull(),
    mappingType: providerMappingType().notNull(),
    externalId: text().notNull(),
    externalName: text(),
    /** Features are mapped within one of our categories (NULL = any category). */
    categoryId: uuid().references(() => categories.id, { onDelete: "cascade" }),
    /** The target: a category (mappingType category), a brand, or a specification definition. */
    targetCategoryId: uuid().references(() => categories.id, { onDelete: "cascade" }),
    targetBrandId: uuid().references(() => brands.id, { onDelete: "cascade" }),
    targetDefinitionId: uuid().references(() => specificationDefinitions.id, {
      onDelete: "cascade",
    }),
    /** { unit: "mm", multiply: 0.1 } etc. Applied before validation against the definition. */
    transform: jsonb().$type<Record<string, unknown>>(),
    /** `ignore` records a deliberate decision not to import this external item. */
    action: text().notNull().default("map"),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    unique("provider_mappings_uq")
      .on(t.provider, t.mappingType, t.externalId, t.categoryId)
      .nullsNotDistinct(),
    check("provider_mappings_provider_ck", PROVIDER_CHECK(t.provider)),
    check("provider_mappings_action_ck", sql`${t.action} IN ('map', 'ignore')`),
    check(
      "provider_mappings_target_ck",
      sql`${t.action} = 'ignore' OR CASE ${t.mappingType}
            WHEN 'category' THEN ${t.targetCategoryId} IS NOT NULL
            WHEN 'brand' THEN ${t.targetBrandId} IS NOT NULL
            ELSE ${t.targetDefinitionId} IS NOT NULL END`,
    ),
  ],
);

/** One unit of work in a provider job (one GTIN, one provider product ID, one search hit). */
export const importJobItems = pgTable(
  "import_job_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    /** What the item asks for: a GTIN-14, a provider product ID, … */
    externalKey: text().notNull(),
    status: importJobItemStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    payloadHash: text(),
    productId: uuid().references(() => products.id, { onDelete: "set null" }),
    variantId: uuid().references(() => productVariants.id, { onDelete: "set null" }),
    /** Summary of what was applied or why not (no raw payloads; those are in the cache). */
    result: jsonb().$type<Record<string, unknown>>(),
    error: text(),
    ...timestamps,
  },
  (t) => [
    unique("import_job_items_key_uq").on(t.jobId, t.externalKey),
    unique("import_job_items_seq_uq").on(t.jobId, t.seq),
    index("import_job_items_status_idx").on(t.jobId, t.status, t.seq),
  ],
);
