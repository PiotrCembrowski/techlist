import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  getCategoryAncestors,
  getCategoryBySlug,
  getCategoryDescendantIds,
  type Category,
} from "@/modules/categories/service";
import { listGuidesForCategories, type GuideSummary } from "@/modules/guides/service";
import { resolveSlugRedirect } from "@/modules/slugs/service";
import {
  getEffectiveDefinitions,
  type EffectiveDefinition,
} from "@/modules/specifications/service";

export interface NavCategory {
  slug: string;
  name: string;
  icon: string | null;
  productCount: number;
  children: { slug: string; name: string; productCount: number }[];
}

/**
 * Active category tree with published product counts (a parent's count includes its
 * descendants). One query; the tree is bounded (≤ 200 categories).
 */
export async function getCategoryTree(db: DbOrTx): Promise<NavCategory[]> {
  const rows = await db.execute<{
    id: string;
    parent_id: string | null;
    slug: string;
    name: string;
    icon: string | null;
    direct: number;
  }>(sql`
    SELECT c.id, c.parent_id, c.slug, c.name, c.icon,
           (SELECT count(*)::int FROM products p JOIN brands b ON b.id = p.brand_id AND b.is_active
             WHERE p.category_id = c.id AND p.status = 'published') AS direct
    FROM categories c WHERE c.is_active
    ORDER BY c.sort_order, c.name
    LIMIT 200`);
  const children = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) {
    if (r.parent_id) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
  }
  const total = (id: string, depth = 0): number => {
    const own = Number(rows.find((r) => r.id === id)?.direct ?? 0);
    if (depth > 8) return own;
    return own + (children.get(id) ?? []).reduce((s, c) => s + total(c.id, depth + 1), 0);
  };
  return rows
    .filter((r) => !r.parent_id)
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      icon: r.icon,
      productCount: total(r.id),
      children: (children.get(r.id) ?? []).map((c) => ({
        slug: c.slug,
        name: c.name,
        productCount: total(c.id),
      })),
    }));
}

export interface BrandSummary {
  slug: string;
  name: string;
  countryOfOrigin: string | null;
  productCount: number;
}

/** Brands ordered by number of published products (homepage, /brands). */
export async function listBrandsByProductCount(db: DbOrTx, limit = 48): Promise<BrandSummary[]> {
  const rows = await db.execute<{
    slug: string;
    name: string;
    country_of_origin: string | null;
    n: number;
  }>(sql`
    SELECT b.slug, b.name, b.country_of_origin, count(p.id)::int AS n
    FROM brands b
    LEFT JOIN products p ON p.brand_id = b.id AND p.status = 'published'
    WHERE b.is_active
    GROUP BY b.id
    HAVING count(p.id) > 0
    ORDER BY n DESC, b.name
    LIMIT ${Math.min(limit, 200)}`);
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    countryOfOrigin: r.country_of_origin,
    productCount: Number(r.n),
  }));
}

export type PageLookup<T> =
  { kind: "ok"; data: T } | { kind: "redirect"; to: string } | { kind: "not_found" };

export interface CategoryPageData {
  category: Category;
  ancestors: Category[];
  children: { slug: string; name: string; productCount: number }[];
  /** Category + all descendants: the listing scope. */
  scopeIds: string[];
  filterable: EffectiveDefinition[];
  brands: BrandSummary[];
  guides: GuideSummary[];
}

export async function getCategoryPageData(
  db: DbOrTx,
  slug: string,
): Promise<PageLookup<CategoryPageData>> {
  const category = await getCategoryBySlug(db, slug);
  if (!category || !category.isActive) {
    const to = await resolveSlugRedirect(db, "category", slug);
    return to ? { kind: "redirect", to: `/categories/${to}` } : { kind: "not_found" };
  }
  const [chain, descendantIds, defs] = await Promise.all([
    getCategoryAncestors(db, category.id),
    getCategoryDescendantIds(db, category.id),
    getEffectiveDefinitions(db, category.id),
  ]);
  const scopeIds = [category.id, ...descendantIds];
  const [childRows, brandRows, guides] = await Promise.all([
    db.execute<{ slug: string; name: string; id: string }>(sql`
      SELECT slug, name, id FROM categories WHERE parent_id = ${category.id} AND is_active ORDER BY sort_order, name LIMIT 50`),
    db.execute<{ slug: string; name: string; country_of_origin: string | null; n: number }>(sql`
      SELECT b.slug, b.name, b.country_of_origin, count(*)::int AS n
      FROM products p JOIN brands b ON b.id = p.brand_id AND b.is_active
      WHERE p.status = 'published' AND p.category_id = ANY(${sql.param(scopeIds)}::uuid[])
      GROUP BY b.id ORDER BY n DESC, b.name LIMIT 50`),
    listGuidesForCategories(
      db,
      chain.map((c) => c.id),
      3,
    ),
  ]);
  const childCounts = childRows.length
    ? await db.execute<{ id: string; n: number }>(sql`
        WITH RECURSIVE tree AS (
          SELECT id AS root_id, id, 0 AS depth FROM categories WHERE id = ANY(${sql.param(childRows.map((c) => c.id))}::uuid[])
          UNION ALL
          SELECT tree.root_id, c.id, tree.depth + 1 FROM categories c JOIN tree ON c.parent_id = tree.id WHERE tree.depth < 8
        )
        SELECT tree.root_id AS id, count(p.id)::int AS n FROM tree
        LEFT JOIN products p ON p.category_id = tree.id AND p.status = 'published'
        GROUP BY tree.root_id`)
    : [];
  const countOf = new Map(childCounts.map((r) => [r.id, Number(r.n)]));
  return {
    kind: "ok",
    data: {
      category,
      ancestors: chain.slice(0, -1),
      children: childRows.map((c) => ({
        slug: c.slug,
        name: c.name,
        productCount: countOf.get(c.id) ?? 0,
      })),
      scopeIds,
      filterable: defs.filter((d) => d.isFilterable && d.isPublic),
      brands: brandRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        countryOfOrigin: r.country_of_origin,
        productCount: Number(r.n),
      })),
      guides,
    },
  };
}

export interface BrandPageData {
  brand: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    officialWebsiteUrl: string | null;
    countryOfOrigin: string | null;
    logoImageKey: string | null;
    isDemo: boolean;
  };
  categories: { slug: string; name: string; productCount: number }[];
  families: { slug: string; name: string; productCount: number }[];
  latestIds: string[];
  discontinuedIds: string[];
  productCount: number;
}

export async function getBrandPageData(
  db: DbOrTx,
  slug: string,
): Promise<PageLookup<BrandPageData>> {
  const [brand] = await db.execute<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    official_website_url: string | null;
    country_of_origin: string | null;
    is_demo: boolean;
    is_active: boolean;
    logo_image_key: string | null;
  }>(
    sql`SELECT id, slug, name, description, official_website_url, country_of_origin, is_demo, is_active, logo_image_key FROM brands WHERE slug = ${slug}`,
  );
  if (!brand || !brand.is_active) {
    const to = await resolveSlugRedirect(db, "brand", slug);
    return to ? { kind: "redirect", to: `/brands/${to}` } : { kind: "not_found" };
  }
  const [categories, families, latest, discontinued] = await Promise.all([
    db.execute<{ slug: string; name: string; n: number }>(sql`
      SELECT c.slug, c.name, count(*)::int AS n FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.brand_id = ${brand.id} AND p.status = 'published'
      GROUP BY c.id ORDER BY c.sort_order, c.name LIMIT 50`),
    db.execute<{ slug: string; name: string; n: number }>(sql`
      SELECT f.slug, f.name, count(p.id)::int AS n FROM product_families f
      JOIN products p ON p.family_id = f.id AND p.status = 'published'
      WHERE f.brand_id = ${brand.id} GROUP BY f.id ORDER BY f.name LIMIT 50`),
    db.execute<{ id: string }>(sql`
      SELECT id FROM products WHERE brand_id = ${brand.id} AND status = 'published' AND product_status <> 'discontinued'
      ORDER BY coalesce(release_date, announced_date) DESC NULLS LAST, name LIMIT 12`),
    db.execute<{ id: string }>(sql`
      SELECT id FROM products WHERE brand_id = ${brand.id} AND status = 'published' AND product_status = 'discontinued'
      ORDER BY discontinued_date DESC NULLS LAST, name LIMIT 12`),
  ]);
  return {
    kind: "ok",
    data: {
      brand: {
        id: brand.id,
        slug: brand.slug,
        name: brand.name,
        description: brand.description,
        officialWebsiteUrl: brand.official_website_url,
        countryOfOrigin: brand.country_of_origin,
        logoImageKey: brand.logo_image_key,
        isDemo: brand.is_demo,
      },
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        productCount: Number(c.n),
      })),
      families: families.map((f) => ({ slug: f.slug, name: f.name, productCount: Number(f.n) })),
      latestIds: latest.map((r) => r.id),
      discontinuedIds: discontinued.map((r) => r.id),
      productCount: categories.reduce((s, c) => s + Number(c.n), 0),
    },
  };
}

/** Product ids for homepage rails. */
export async function getHomeProductIds(db: DbOrTx, limit = 8) {
  const [featured, recent] = await Promise.all([
    db.execute<{ id: string }>(sql`
      SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id AND b.is_active
      WHERE p.status = 'published' AND p.is_featured
      ORDER BY coalesce(p.release_date, p.announced_date) DESC NULLS LAST, p.name LIMIT ${limit}`),
    db.execute<{ id: string }>(sql`
      SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id AND b.is_active
      WHERE p.status = 'published'
      ORDER BY p.created_at DESC, p.name LIMIT ${limit}`),
  ]);
  return { featuredIds: featured.map((r) => r.id), recentIds: recent.map((r) => r.id) };
}
