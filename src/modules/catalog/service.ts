import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { getPrimaryImages, type PublicImage } from "@/modules/media/public";
import { formatSpecValue } from "@/lib/format";
import { MAX_PAGE_SIZE } from "@/modules/_shared/context";
import { freshOfferSql, getLowestFreshOffers, type LowestOffer } from "@/modules/offers/read";
import { buildPrefixTsQuery } from "@/modules/search/query";
import {
  getEffectiveDefinitionsForCategories,
  getSpecificationsForProducts,
} from "@/modules/specifications/service";
import type { CatalogFilters } from "./filters";

export const DEFAULT_PAGE_SIZE = 24;
const CARD_SPEC_COUNT = 4;

export interface CatalogScope {
  /** Restrict to these categories (pass a category and its descendants). */
  categoryIds?: string[];
  /** Restrict to one brand (brand pages). */
  brandId?: string;
}

export interface CatalogOptions {
  market: string;
  staleHours: number;
  /** Only honoured when set: the market's single currency (price filter + price sort). */
  priceCurrency?: string | null;
  pageSize?: number;
}

export interface ProductCardData {
  id: string;
  slug: string;
  href: string;
  name: string;
  modelNumber: string | null;
  shortDescription: string | null;
  releaseYear: number | null;
  productStatus: string;
  verificationStatus: string;
  lastVerifiedAt: Date | null;
  isDemo: boolean;
  brand: { slug: string; name: string };
  category: { slug: string; name: string; icon: string | null };
  /** Root of the category tree; products can only be compared within one top-level category. */
  topCategory: { slug: string; name: string };
  keySpecs: { key: string; label: string; value: string }[];
  offer: LowestOffer | null;
  image: PublicImage | null;
}

export function productHref(brandSlug: string, productSlug: string, variantCode?: string | null) {
  return `/products/${brandSlug}/${productSlug}${variantCode ? `?variant=${encodeURIComponent(variantCode)}` : ""}`;
}

type Row = {
  id: string;
  slug: string;
  name: string;
  model_number: string | null;
  short_description: string | null;
  release_date: string | null;
  product_status: string;
  verification_status: string;
  last_verified_at: string | null;
  is_demo: boolean;
  category_id: string;
  brand_slug: string;
  brand_name: string;
  category_slug: string;
  category_name: string;
  category_icon: string | null;
};

function buildWhere(scope: CatalogScope, f: CatalogFilters, opts: CatalogOptions): SQL {
  const parts: SQL[] = [
    sql`p.publication_status = 'published'`,
    sql`b.is_active`,
    sql`c.is_active`,
  ];
  if (scope.categoryIds?.length)
    parts.push(sql`p.category_id = ANY(${sql.param(scope.categoryIds)}::uuid[])`);
  if (scope.brandId) parts.push(sql`p.brand_id = ${scope.brandId}`);
  if (f.brandSlugs.length) parts.push(sql`b.slug = ANY(${sql.param(f.brandSlugs)}::text[])`);
  if (f.status) parts.push(sql`p.product_status = ${f.status}`);
  if (f.q) {
    const tsq = buildPrefixTsQuery(f.q);
    parts.push(sql`(
      lower(p.model_number) = lower(${f.q}) OR lower(p.manufacturer_part_number) = lower(${f.q})
      ${tsq ? sql`OR p.search_vector @@ to_tsquery('simple', ${tsq})` : sql``}
      OR word_similarity(lower(sb_unaccent(${f.q})), lower(sb_unaccent(p.name))) >= 0.5
    )`);
  }
  for (const s of f.specs) {
    // Matches a product-level value or any variant's value ("available with ≥ 1 TB").
    const base = sql`SELECT 1 FROM product_specifications ps WHERE ps.product_id = p.id AND ps.specification_definition_id = ${s.definitionId}`;
    if (s.kind === "range") {
      const conds: SQL[] = [];
      if (s.min !== undefined) conds.push(sql`ps.value_numeric >= ${s.min}`);
      if (s.max !== undefined) conds.push(sql`ps.value_numeric <= ${s.max}`);
      parts.push(sql`EXISTS (${base} AND ${sql.join(conds, sql` AND `)})`);
    } else if (s.kind === "options") {
      parts.push(
        sql`EXISTS (${base} AND (ps.value_text = ANY(${sql.param(s.values)}::text[]) OR ps.value_json ?| ${sql.param(s.values)}::text[]))`,
      );
    } else {
      parts.push(sql`EXISTS (${base} AND ps.value_boolean = ${s.value})`);
    }
  }
  if (opts.priceCurrency && (f.priceMin !== null || f.priceMax !== null)) {
    if (f.priceMin !== null) parts.push(sql`lp.price_amount >= ${f.priceMin}`);
    if (f.priceMax !== null) parts.push(sql`lp.price_amount <= ${f.priceMax}`);
  }
  return sql.join(parts, sql` AND `);
}

/** Lowest fresh, in-stock offer in the selected market and its currency (for price filter/sort). */
function lowestPriceJoin(opts: CatalogOptions): SQL {
  if (!opts.priceCurrency || opts.market === "ALL")
    return sql`LEFT JOIN LATERAL (SELECT NULL::numeric AS price_amount) lp ON TRUE`;
  return sql`LEFT JOIN LATERAL (
    SELECT o.price_amount FROM retailer_offers o
    WHERE o.product_id = p.id AND o.market_country_code = ${opts.market} AND o.currency = ${opts.priceCurrency}
      AND o.availability_status <> 'out_of_stock' AND ${freshOfferSql(opts.staleHours)}
    ORDER BY o.price_amount LIMIT 1
  ) lp ON TRUE`;
}

function orderBy(f: CatalogFilters, opts: CatalogOptions): SQL {
  switch (f.sort) {
    case "name":
      return sql`p.name ASC, p.id`;
    case "release_date":
      return sql`p.release_date DESC NULLS LAST, p.id`;
    case "price_asc":
      return opts.priceCurrency
        ? sql`lp.price_amount ASC NULLS LAST, p.name, p.id`
        : sql`p.created_at DESC, p.id`;
    default:
      return sql`p.created_at DESC, p.name, p.id`;
  }
}

/**
 * The one catalogue query used by /products, category and brand pages. Three queries per page in
 * total (rows+count, key specs, offers) regardless of page size — no N+1.
 */
export async function listCatalog(
  db: DbOrTx,
  scope: CatalogScope,
  f: CatalogFilters,
  opts: CatalogOptions,
) {
  const pageSize = Math.min(opts.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const where = buildWhere(scope, f, opts);
  const from = sql`FROM products p
    JOIN brands b ON b.id = p.brand_id
    JOIN categories c ON c.id = p.category_id
    ${lowestPriceJoin(opts)}`;

  const [rows, [countRow]] = await Promise.all([
    db.execute<Row>(sql`
      SELECT p.id, p.slug, p.name, p.model_number, p.short_description, p.release_date::text, p.product_status,
             p.verification_status, p.last_verified_at::text, p.is_demo, p.category_id,
             b.slug AS brand_slug, b.name AS brand_name, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon
      ${from}
      WHERE ${where}
      ORDER BY ${orderBy(f, opts)}
      LIMIT ${pageSize} OFFSET ${(f.page - 1) * pageSize}`),
    db.execute<{ n: number }>(sql`SELECT count(*)::int AS n ${from} WHERE ${where}`),
  ]);
  const total = Number(countRow?.n ?? 0);
  const items = await toCards(db, rows as unknown as Row[], opts);
  return {
    items,
    total,
    page: f.page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** category id -> its top-level category (one small query; the tree is bounded at 200). */
async function getTopCategoryMap(db: DbOrTx): Promise<Map<string, { slug: string; name: string }>> {
  const cats = await db.execute<{
    id: string;
    parent_id: string | null;
    slug: string;
    name: string;
  }>(sql`SELECT id, parent_id, slug, name FROM categories LIMIT 200`);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out = new Map<string, { slug: string; name: string }>();
  for (const c of cats) {
    let cur = c;
    for (let i = 0; i < 8 && cur.parent_id && byId.has(cur.parent_id); i++)
      cur = byId.get(cur.parent_id)!;
    out.set(c.id, { slug: cur.slug, name: cur.name });
  }
  return out;
}

/** Enrich product rows with key specs and the market's lowest fresh offer (batched queries). */
async function toCards(db: DbOrTx, rows: Row[], opts: CatalogOptions): Promise<ProductCardData[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const defsByCategory = await getEffectiveDefinitionsForCategories(db, [
    ...new Set(rows.map((r) => r.category_id)),
  ]);
  const cardDefs = new Map(
    [...defsByCategory].map(([cid, defs]) => [
      cid,
      defs.filter((d) => d.isPublic && d.isComparable),
    ]),
  );
  const allDefIds = [...new Set([...cardDefs.values()].flat().map((d) => d.id))];
  const [specs, offers, topOf, images] = await Promise.all([
    getSpecificationsForProducts(db, ids, allDefIds),
    getLowestFreshOffers(db, ids, opts.market, opts.staleHours),
    getTopCategoryMap(db),
    getPrimaryImages(db, ids),
  ]);

  return rows.map((r) => {
    const values = new Map((specs.get(r.id) ?? []).map((s) => [s.specificationDefinitionId, s]));
    const keySpecs: ProductCardData["keySpecs"] = [];
    for (const d of cardDefs.get(r.category_id) ?? []) {
      if (keySpecs.length >= CARD_SPEC_COUNT) break;
      const text = formatSpecValue(d, values.get(d.id));
      if (text) keySpecs.push({ key: d.key, label: d.name, value: text });
    }
    return {
      id: r.id,
      slug: r.slug,
      href: productHref(r.brand_slug, r.slug),
      name: r.name,
      modelNumber: r.model_number,
      shortDescription: r.short_description,
      releaseYear: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
      productStatus: r.product_status,
      verificationStatus: r.verification_status,
      lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at) : null,
      isDemo: r.is_demo,
      brand: { slug: r.brand_slug, name: r.brand_name },
      category: { slug: r.category_slug, name: r.category_name, icon: r.category_icon },
      topCategory: topOf.get(r.category_id) ?? { slug: r.category_slug, name: r.category_name },
      keySpecs,
      offer: offers.get(r.id) ?? null,
      image: images.get(r.id) ?? null,
    };
  });
}

/** Cards for an explicit list of product ids, in the given order (homepage, related products). */
export async function getProductCards(
  db: DbOrTx,
  productIds: string[],
  opts: CatalogOptions,
): Promise<ProductCardData[]> {
  if (productIds.length === 0) return [];
  const rows = (await db.execute<Row>(sql`
    SELECT p.id, p.slug, p.name, p.model_number, p.short_description, p.release_date::text, p.product_status,
           p.verification_status, p.last_verified_at::text, p.is_demo, p.category_id,
           b.slug AS brand_slug, b.name AS brand_name, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon
    FROM products p JOIN brands b ON b.id = p.brand_id JOIN categories c ON c.id = p.category_id
    WHERE p.id = ANY(${sql.param(productIds.slice(0, MAX_PAGE_SIZE))}::uuid[])
      AND p.publication_status = 'published' AND b.is_active`)) as unknown as Row[];
  const order = new Map(productIds.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return toCards(db, rows, opts);
}

export interface NumericRange {
  definitionId: string;
  min: number;
  max: number;
}

/** Observed min/max per numeric filter within a scope — shown as placeholders in range inputs. */
export async function getFilterRanges(
  db: DbOrTx,
  categoryIds: string[],
  definitionIds: string[],
): Promise<Map<string, NumericRange>> {
  if (!categoryIds.length || !definitionIds.length) return new Map();
  const rows = await db.execute<{ definition_id: string; min: string; max: string }>(sql`
    SELECT ps.specification_definition_id AS definition_id, min(ps.value_numeric)::text AS min, max(ps.value_numeric)::text AS max
    FROM product_specifications ps JOIN products p ON p.id = ps.product_id
    WHERE p.publication_status = 'published' AND p.category_id = ANY(${sql.param(categoryIds)}::uuid[])
      AND ps.specification_definition_id = ANY(${sql.param(definitionIds)}::uuid[]) AND ps.value_numeric IS NOT NULL
    GROUP BY 1`);
  return new Map(
    rows.map((r) => [
      r.definition_id,
      { definitionId: r.definition_id, min: Number(r.min), max: Number(r.max) },
    ]),
  );
}
