import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { SLUG_CHECK, timestamps } from "./_shared";
import { categories, products } from "./catalog";
import { publicationStatus, slugEntityType } from "./enums";

export const guides = pgTable(
  "guides",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    slug: text().notNull().unique(),
    summary: text(),
    bodyMarkdown: text().notNull(),
    authorName: text(),
    publicationStatus: publicationStatus().notNull().default("draft"),
    publishedAt: timestamp({ withTimezone: true }),
    seoTitle: text(),
    seoDescription: text(),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check("guides_slug_ck", SLUG_CHECK(t.slug)),
    index("guides_published_idx").on(t.publicationStatus, t.publishedAt.desc()),
  ],
);

export const guideProducts = pgTable(
  "guide_products",
  {
    guideId: uuid()
      .notNull()
      .references(() => guides.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.guideId, t.productId] }),
    index("guide_products_product_idx").on(t.productId),
  ],
);

export const guideCategories = pgTable(
  "guide_categories",
  {
    guideId: uuid()
      .notNull()
      .references(() => guides.id, { onDelete: "cascade" }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.guideId, t.categoryId] }),
    index("guide_categories_category_idx").on(t.categoryId),
  ],
);

export const featuredComparisons = pgTable(
  "featured_comparisons",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull().unique(),
    productIds: uuid().array().notNull(),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [check("featured_comparisons_size_ck", sql`cardinality(${t.productIds}) BETWEEN 2 AND 4`)],
);

export const slugRedirects = pgTable(
  "slug_redirects",
  {
    id: uuid().primaryKey().defaultRandom(),
    entityType: slugEntityType().notNull(),
    oldSlug: text().notNull(),
    newSlug: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("slug_redirects_old_uq").on(t.entityType, t.oldSlug),
    check("slug_redirects_differs_ck", sql`${t.oldSlug} <> ${t.newSlug}`),
  ],
);
