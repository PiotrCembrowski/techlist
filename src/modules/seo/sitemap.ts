import { sql } from "drizzle-orm";
import { getEnv } from "@/config/env";
import type { DbOrTx } from "@/lib/db";
import { comparisonPath } from "@/modules/comparisons/url";

/** Search engines accept at most 50,000 URLs per sitemap file. */
export const SITEMAP_LIMIT = 50_000;

export interface SitemapEntry {
  path: string;
  lastModified: Date | null;
}

/** Content pages and listings; listings only when they list something indexable (SPEC §12). */
async function fixedEntries(db: DbOrTx): Promise<SitemapEntry[]> {
  const [counts] = await db.execute<{
    products: number;
    brands: number;
    guides: number;
    categories: number;
  }>(sql`
    WITH ip AS MATERIALIZED (SELECT id, brand_id FROM indexable_products)
    SELECT (SELECT count(*)::int FROM ip) AS products,
           (SELECT count(DISTINCT brand_id)::int FROM ip) AS brands,
           (SELECT count(*)::int FROM guides WHERE publication_status = 'published' AND NOT is_demo
              AND (published_at IS NULL OR published_at <= now())) AS guides,
           (SELECT count(*)::int FROM categories WHERE is_active AND parent_id IS NULL) AS categories`);
  const c = counts!;
  const comparisons = await db.execute<{ slugs: string[]; updated_at: string }>(sql`
    WITH ip AS MATERIALIZED (
      SELECT id FROM indexable_products WHERE id IN (SELECT unnest(product_ids) FROM featured_comparisons WHERE is_active)
    )
    SELECT array_agg(p.slug ORDER BY p.slug) AS slugs, fc.updated_at::text
    FROM featured_comparisons fc
    JOIN LATERAL unnest(fc.product_ids) AS u(id) ON true
    JOIN products p ON p.id = u.id
    WHERE fc.is_active
    GROUP BY fc.id
    -- Every product must be indexable (and the comparison must stay within one category).
    HAVING bool_and(p.id IN (SELECT id FROM ip)) AND count(DISTINCT p.category_id) = 1
    ORDER BY fc.id LIMIT 200`);
  return [
    { path: "/", lastModified: null },
    ...(c.products ? [{ path: "/products", lastModified: null }] : []),
    ...(c.categories ? [{ path: "/categories", lastModified: null }] : []),
    ...(c.brands ? [{ path: "/brands", lastModified: null }] : []),
    ...(c.guides ? [{ path: "/guides", lastModified: null }] : []),
    { path: "/about", lastModified: null },
    { path: "/data-policy", lastModified: null },
    { path: "/affiliate-disclosure", lastModified: null },
    { path: "/privacy", lastModified: null },
    ...comparisons.map((r) => ({
      path: comparisonPath(r.slugs),
      lastModified: new Date(r.updated_at),
    })),
  ];
}

/** Indexable categories, brands, guides and products, in a stable order (paged in SQL). */
const DYNAMIC = sql`
  WITH RECURSIVE category_ancestors(category_id, ancestor_id, depth) AS (
    SELECT id, id, 0 FROM categories
    UNION ALL
    SELECT a.category_id, c.parent_id, a.depth + 1 FROM category_ancestors a JOIN categories c ON c.id = a.ancestor_id
    WHERE c.parent_id IS NOT NULL AND a.depth < 8
  ),
  -- Evaluate the indexability view once for the whole sitemap.
  ip AS MATERIALIZED (SELECT * FROM indexable_products),
  entries AS (
    SELECT 1 AS ord, c.slug AS sort_key, '/categories/' || c.slug AS path, c.updated_at AS last_modified
    FROM categories c
    WHERE c.is_active AND c.id IN (
      SELECT a.ancestor_id FROM category_ancestors a WHERE a.category_id IN (SELECT DISTINCT category_id FROM ip))
    UNION ALL
    SELECT 2, b.slug, '/brands/' || b.slug, b.updated_at
    FROM brands b WHERE b.is_active AND NOT b.is_demo AND b.id IN (SELECT DISTINCT brand_id FROM ip)
    UNION ALL
    SELECT 3, g.slug, '/guides/' || g.slug, g.updated_at
    FROM guides g WHERE g.publication_status = 'published' AND NOT g.is_demo AND (g.published_at IS NULL OR g.published_at <= now())
    UNION ALL
    SELECT 4, ip.brand_slug || '/' || ip.slug, '/products/' || ip.brand_slug || '/' || ip.slug, ip.updated_at
    FROM ip
  )`;

async function dynamicCount(db: DbOrTx): Promise<number> {
  const [r] = await db.execute<{ n: number }>(
    sql`${DYNAMIC} SELECT count(*)::int AS n FROM entries`,
  );
  return Number(r?.n ?? 0);
}

async function dynamicEntries(db: DbOrTx, offset: number, limit: number): Promise<SitemapEntry[]> {
  if (limit <= 0) return [];
  const rows = await db.execute<{ path: string; last_modified: string | null }>(sql`
    ${DYNAMIC} SELECT path, last_modified::text FROM entries ORDER BY ord, sort_key LIMIT ${limit} OFFSET ${offset}`);
  return rows.map((r) => ({
    path: r.path,
    lastModified: r.last_modified ? new Date(r.last_modified) : null,
  }));
}

/** How many sitemap files are needed (at least one). Nothing is listed while demo data is on. */
export async function sitemapCount(db: DbOrTx, limit = SITEMAP_LIMIT): Promise<number> {
  if (getEnv().ENABLE_DEMO_DATA) return 1;
  const total = (await fixedEntries(db)).length + (await dynamicCount(db));
  return Math.max(1, Math.ceil(total / limit));
}

/** Sitemap file `id` (0-based): fixed entries first, then the dynamic list, `limit` per file. */
export async function sitemapEntries(
  db: DbOrTx,
  id: number,
  limit = SITEMAP_LIMIT,
): Promise<SitemapEntry[]> {
  if (getEnv().ENABLE_DEMO_DATA) return [];
  const fixed = await fixedEntries(db);
  const start = id * limit;
  const fromFixed = fixed.slice(start, start + limit);
  const dynamicOffset = Math.max(0, start - fixed.length);
  return [...fromFixed, ...(await dynamicEntries(db, dynamicOffset, limit - fromFixed.length))];
}
