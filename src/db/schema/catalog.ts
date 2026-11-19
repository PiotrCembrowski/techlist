import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { COUNTRY_CHECK, SLUG_CHECK, timestamps, tsvector } from "./_shared";
import {
  comparisonDirection,
  imageType,
  linkType,
  productStatus,
  publicationStatus,
  relationshipType,
  sourceType,
  specDataType,
  specOrigin,
  specVerificationStatus,
  verificationStatus,
} from "./enums";

// ─── Sources (provenance) ──────────────────────────────────────────────────────────────

export const sources = pgTable(
  "sources",
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceName: text().notNull(),
    sourceType: sourceType().notNull(),
    sourceUrl: text(),
    providerName: text(),
    licenseType: text(),
    licenseNotes: text(),
    accessMethod: text(),
    retrievedAt: timestamp({ withTimezone: true }),
    attributionRequired: boolean().notNull().default(false),
    /** Imports refuse sources where this is false. Unknown rights default to "not permitted". */
    usagePermitted: boolean().notNull().default(false),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("sources_name_uq").on(sql`lower(${t.sourceName})`)],
);

// ─── Brands ────────────────────────────────────────────────────────────────────────────

export const brands = pgTable(
  "brands",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    description: text(),
    officialWebsiteUrl: text(),
    logoImageKey: text(),
    countryOfOrigin: text(),
    aliases: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isActive: boolean().notNull().default(true),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    // sb_unaccent is an IMMUTABLE wrapper around unaccent() (see migration 0000).
    uniqueIndex("brands_name_normalized_uq").on(sql`lower(sb_unaccent(${t.name}))`),
    index("brands_aliases_gin").using("gin", t.aliases),
    index("brands_name_trgm").using("gin", t.name.op("gin_trgm_ops")),
    check("brands_slug_ck", SLUG_CHECK(t.slug)),
    check(
      "brands_country_ck",
      sql`${t.countryOfOrigin} IS NULL OR ${COUNTRY_CHECK(t.countryOfOrigin)}`,
    ),
  ],
);

// ─── Categories ────────────────────────────────────────────────────────────────────────

export const categories = pgTable(
  "categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
    name: text().notNull(),
    slug: text().notNull().unique(),
    description: text(),
    icon: text(),
    sortOrder: integer().notNull().default(0),
    seoTitle: text(),
    seoDescription: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("categories_parent_idx").on(t.parentId),
    check("categories_slug_ck", SLUG_CHECK(t.slug)),
    check("categories_not_own_parent_ck", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
);

// ─── Product families ──────────────────────────────────────────────────────────────────

export const productFamilies = pgTable(
  "product_families",
  {
    id: uuid().primaryKey().defaultRandom(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    ...timestamps,
  },
  (t) => [
    unique("product_families_brand_slug_uq").on(t.brandId, t.slug),
    check("product_families_slug_ck", SLUG_CHECK(t.slug)),
  ],
);

// ─── Products ──────────────────────────────────────────────────────────────────────────

export const products = pgTable(
  "products",
  {
    id: uuid().primaryKey().defaultRandom(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    familyId: uuid().references(() => productFamilies.id, { onDelete: "set null" }),
    name: text().notNull(),
    slug: text().notNull().unique(),
    modelName: text(),
    modelNumber: text(),
    manufacturerPartNumber: text(),
    aliases: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text(),
    shortDescription: text(),
    releaseDate: date({ mode: "string" }),
    announcedDate: date({ mode: "string" }),
    discontinuedDate: date({ mode: "string" }),
    productStatus: productStatus().notNull().default("unknown"),
    publicationStatus: publicationStatus().notNull().default("draft"),
    verificationStatus: verificationStatus().notNull().default("draft"),
    lastVerifiedAt: timestamp({ withTimezone: true }),
    isFeatured: boolean().notNull().default(false),
    isDemo: boolean().notNull().default(false),
    seoTitle: text(),
    seoDescription: text(),
    /** Maintained by the `sb_products_search_vector` trigger (includes the brand name). */
    searchVector: tsvector(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_brand_model_number_uq")
      .on(t.brandId, sql`lower(${t.modelNumber})`)
      .where(sql`${t.modelNumber} IS NOT NULL`),
    index("products_name_trgm").using("gin", t.name.op("gin_trgm_ops")),
    index("products_model_number_trgm").using("gin", t.modelNumber.op("gin_trgm_ops")),
    index("products_mpn_trgm").using("gin", t.manufacturerPartNumber.op("gin_trgm_ops")),
    index("products_aliases_gin").using("gin", t.aliases),
    index("products_search_vector_gin").using("gin", t.searchVector),
    index("products_category_pub_idx").on(t.categoryId, t.publicationStatus),
    index("products_brand_pub_idx").on(t.brandId, t.publicationStatus),
    index("products_family_idx").on(t.familyId),
    index("products_created_idx").on(t.createdAt.desc()),
    check("products_slug_ck", sql`${SLUG_CHECK(t.slug)} AND position('-vs-' in ${t.slug}) = 0`),
  ],
);

// ─── Variants ──────────────────────────────────────────────────────────────────────────

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantName: text().notNull(),
    variantCode: text().notNull(),
    manufacturerPartNumber: text(),
    /** ISO country code or a two-letter region such as EU; NULL means global. */
    regionCode: text(),
    color: text(),
    memoryConfiguration: text(),
    storageConfiguration: text(),
    configurationLabel: text(),
    barcodeGtin: text(),
    sku: text(),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("product_variants_product_code_uq").on(t.productId, t.variantCode),
    uniqueIndex("product_variants_gtin_uq")
      .on(t.barcodeGtin)
      .where(sql`${t.barcodeGtin} IS NOT NULL`),
    uniqueIndex("product_variants_one_default_uq")
      .on(t.productId)
      .where(sql`${t.isDefault}`),
    index("product_variants_product_idx").on(t.productId),
    index("product_variants_mpn_idx").on(sql`lower(${t.manufacturerPartNumber})`),
    check("product_variants_code_ck", SLUG_CHECK(t.variantCode)),
    check(
      "product_variants_region_ck",
      sql`${t.regionCode} IS NULL OR ${COUNTRY_CHECK(t.regionCode)}`,
    ),
    check(
      "product_variants_gtin_ck",
      sql`${t.barcodeGtin} IS NULL OR ${t.barcodeGtin} ~ '^([0-9]{8}|[0-9]{12,14})$'`,
    ),
  ],
);

// ─── Specification groups / definitions / values ───────────────────────────────────────

export const specificationGroups = pgTable(
  "specification_groups",
  {
    id: uuid().primaryKey().defaultRandom(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    displayOrder: integer().notNull().default(0),
  },
  (t) => [
    unique("specification_groups_category_key_uq").on(t.categoryId, t.key),
    check("specification_groups_key_ck", sql`${t.key} ~ '^[a-z][a-z0-9_]*$'`),
  ],
);

export const specificationDefinitions = pgTable(
  "specification_definitions",
  {
    id: uuid().primaryKey().defaultRandom(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    groupId: uuid().references(() => specificationGroups.id, { onDelete: "set null" }),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    dataType: specDataType().notNull(),
    canonicalUnit: text(),
    displayOrder: integer().notNull().default(0),
    isFilterable: boolean().notNull().default(false),
    isComparable: boolean().notNull().default(true),
    isRequired: boolean().notNull().default(false),
    isPublic: boolean().notNull().default(true),
    comparisonDirection: comparisonDirection().notNull().default("none"),
    validationRules: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique("specification_definitions_category_key_uq").on(t.categoryId, t.key),
    index("specification_definitions_category_idx").on(t.categoryId),
    check("specification_definitions_key_ck", sql`${t.key} ~ '^[a-z][a-z0-9_]*$'`),
    check(
      "specification_definitions_unit_ck",
      sql`${t.canonicalUnit} IS NULL OR ${t.dataType} IN ('integer', 'decimal')`,
    ),
    check(
      "specification_definitions_direction_ck",
      sql`${t.comparisonDirection} = 'none' OR ${t.dataType} IN ('integer', 'decimal', 'date', 'boolean')`,
    ),
  ],
);

export const productSpecifications = pgTable(
  "product_specifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, { onDelete: "cascade" }),
    specificationDefinitionId: uuid()
      .notNull()
      .references(() => specificationDefinitions.id, { onDelete: "restrict" }),
    valueText: text(),
    valueNumeric: numeric({ mode: "number" }),
    valueBoolean: boolean(),
    valueDate: date({ mode: "string" }),
    valueJson: jsonb().$type<string[]>(),
    sourceId: uuid().references(() => sources.id, { onDelete: "set null" }),
    origin: specOrigin().notNull().default("manual"),
    confidence: numeric({ precision: 4, scale: 3, mode: "number" }),
    verificationStatus: specVerificationStatus().notNull().default("unverified"),
    lastVerifiedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("product_specifications_value_uq")
      .on(t.productId, t.variantId, t.specificationDefinitionId)
      .nullsNotDistinct(),
    index("product_specifications_filter_idx").on(t.specificationDefinitionId, t.valueNumeric),
    index("product_specifications_product_idx").on(t.productId),
    check(
      "product_specifications_one_value_ck",
      sql`num_nonnulls(${t.valueText}, ${t.valueNumeric}, ${t.valueBoolean}, ${t.valueDate}, ${t.valueJson}) = 1`,
    ),
    check(
      "product_specifications_confidence_ck",
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
    ),
    // A value can only be "verified" with a verification timestamp (set by a human approval).
    check(
      "product_specifications_verified_at_ck",
      sql`${t.verificationStatus} <> 'verified' OR ${t.lastVerifiedAt} IS NOT NULL`,
    ),
  ],
);

// ─── Source records, links, images, relationships ──────────────────────────────────────

export const productSourceRecords = pgTable(
  "product_source_records",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, { onDelete: "cascade" }),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    sourceProductIdentifier: text(),
    sourceUrl: text(),
    rawDataReference: text(),
    retrievedAt: timestamp({ withTimezone: true }),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("product_source_records_product_idx").on(t.productId),
    unique("product_source_records_uq").on(t.productId, t.variantId, t.sourceId).nullsNotDistinct(),
  ],
);

export const productLinks = pgTable(
  "product_links",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    linkType: linkType().notNull(),
    url: text().notNull(),
    sourceId: uuid().references(() => sources.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("product_links_uq").on(t.productId, t.linkType, t.url),
    check("product_links_https_ck", sql`${t.url} ~ '^https://'`),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, { onDelete: "cascade" }),
    /** Key in the StorageDriver. Uploaded files only — never an external URL. */
    storageKey: text().notNull().unique(),
    altText: text().notNull(),
    imageType: imageType().notNull().default("product"),
    sourceId: uuid().references(() => sources.id, { onDelete: "set null" }),
    licenseType: text(),
    attributionText: text(),
    displayOrder: integer().notNull().default(0),
    isPrimary: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("product_images_one_primary_uq")
      .on(t.productId)
      .where(sql`${t.isPrimary}`),
    index("product_images_product_idx").on(t.productId, t.displayOrder),
    check("product_images_key_ck", sql`${t.storageKey} !~ '^[a-z]+://'`),
  ],
);

export const productRelationships = pgTable(
  "product_relationships",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** For `successor`: source is the OLDER product, target is its successor. Predecessor is derived. */
    sourceProductId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    targetProductId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relationshipType: relationshipType().notNull(),
    confidence: numeric({ precision: 4, scale: 3, mode: "number" }),
    sourceId: uuid().references(() => sources.id, { onDelete: "set null" }),
    isVerified: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("product_relationships_uq").on(t.sourceProductId, t.targetProductId, t.relationshipType),
    index("product_relationships_target_idx").on(t.targetProductId, t.relationshipType),
    check("product_relationships_not_self_ck", sql`${t.sourceProductId} <> ${t.targetProductId}`),
  ],
);
