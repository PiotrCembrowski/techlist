import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { productHref } from "@/modules/catalog/service";
import { getCategoryAncestors } from "@/modules/categories/service";
import { getLowestFreshOffers, type LowestOffer } from "@/modules/offers/read";
import { resolveSlugRedirect } from "@/modules/slugs/service";
import {
  getEffectiveDefinitions,
  getSpecificationsForProducts,
} from "@/modules/specifications/service";
import { buildComparisonGroups, lowestCommonCategory, type CompareGroup } from "./rows";
import { canonicalSlugs, comparisonPath, MAX_COMPARE } from "./url";

export interface ComparedProduct {
  id: string;
  slug: string;
  name: string;
  href: string;
  modelNumber: string | null;
  releaseDate: string | null;
  lastVerifiedAt: Date | null;
  isDemo: boolean;
  brand: { slug: string; name: string };
  category: { id: string; slug: string; name: string; icon: string | null };
  topCategory: { slug: string; name: string };
  offer: LowestOffer | null;
}

export type ComparisonResult =
  | { kind: "not_found" }
  | { kind: "redirect"; to: string }
  | { kind: "mixed_categories"; products: ComparedProduct[] }
  | {
      kind: "ok";
      products: ComparedProduct[];
      category: { slug: string; name: string };
      groups: CompareGroup[];
    };

type Row = {
  id: string;
  slug: string;
  name: string;
  model_number: string | null;
  release_date: string | null;
  last_verified_at: string | null;
  is_demo: boolean;
  brand_slug: string;
  brand_name: string;
  category_id: string;
  category_slug: string;
  category_name: string;
  category_icon: string | null;
};

/**
 * Side-by-side comparison of 2–4 published products. Products must share a top-level category;
 * rows come from the comparable definitions of their deepest common category (inherited ones
 * included), in canonical units. Old product slugs redirect to the renamed products.
 */
export async function compareProducts(
  db: DbOrTx,
  slugs: string[],
  opts: { market: string; staleHours: number },
): Promise<ComparisonResult> {
  const wanted = canonicalSlugs(slugs).slice(0, MAX_COMPARE);
  const rows = (await db.execute<Row>(sql`
    SELECT p.id, p.slug, p.name, p.model_number, p.release_date::text,
           p.last_verified_at::text, p.is_demo, b.slug AS brand_slug, b.name AS brand_name,
           c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon
    FROM products p JOIN brands b ON b.id = p.brand_id AND b.is_active JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ANY(${sql.param(wanted)}::text[]) AND p.status = 'published'`)) as unknown as Row[];

  if (rows.length < wanted.length) {
    const found = new Set(rows.map((r) => r.slug));
    const resolved: string[] = [];
    for (const s of wanted) {
      if (found.has(s)) resolved.push(s);
      else {
        const to = await resolveSlugRedirect(db, "product", s);
        if (!to) return { kind: "not_found" };
        resolved.push(to);
      }
    }
    const path = comparisonPath(resolved);
    return path === "/compare" ? { kind: "not_found" } : { kind: "redirect", to: path };
  }

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const ordered = wanted.map((s) => bySlug.get(s)!);
  const ids = ordered.map((r) => r.id);
  const categoryIds = [...new Set(ordered.map((r) => r.category_id))];
  const [chainList, offers] = await Promise.all([
    Promise.all(categoryIds.map((id) => getCategoryAncestors(db, id))),
    getLowestFreshOffers(db, ids, opts.market, opts.staleHours),
  ]);
  const chains = new Map(categoryIds.map((id, i) => [id, chainList[i]!]));

  const products: ComparedProduct[] = ordered.map((r) => {
    const top = chains.get(r.category_id)![0]!;
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      href: productHref(r.brand_slug, r.slug),
      modelNumber: r.model_number,
      releaseDate: r.release_date,
      lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at) : null,
      isDemo: r.is_demo,
      brand: { slug: r.brand_slug, name: r.brand_name },
      category: {
        id: r.category_id,
        slug: r.category_slug,
        name: r.category_name,
        icon: r.category_icon,
      },
      topCategory: { slug: top.slug, name: top.name },
      offer: offers.get(r.id) ?? null,
    };
  });

  const commonId = lowestCommonCategory(
    ordered.map((r) => chains.get(r.category_id)!.map((c) => c.id)),
  );
  if (!commonId) return { kind: "mixed_categories", products };
  const common = [...chains.values()].flat().find((c) => c.id === commonId)!;

  const defs = (await getEffectiveDefinitions(db, commonId)).filter(
    (d) => d.isComparable && d.isPublic,
  );
  const values = await getSpecificationsForProducts(
    db,
    ids,
    defs.map((d) => d.id),
  );
  const sourceIds = [
    ...new Set(
      [...values.values()]
        .flat()
        .map((v) => v.sourceId)
        .filter((x): x is string => !!x),
    ),
  ];
  const manufacturer = sourceIds.length
    ? await db.execute<{ id: string }>(sql`
        SELECT id FROM sources WHERE id = ANY(${sql.param(sourceIds)}::uuid[]) AND source_type = 'manufacturer'`)
    : [];

  return {
    kind: "ok",
    products,
    category: { slug: common.slug, name: common.name },
    groups: buildComparisonGroups(defs, ids, values, new Set(manufacturer.map((m) => m.id))),
  };
}

export interface FeaturedComparison {
  title: string;
  path: string;
  products: { name: string; brandName: string }[];
}

/**
 * Editor-curated comparisons (never "popular" lists without data). Only shown when every
 * product is published; optionally only those involving one brand.
 */
export async function listFeaturedComparisons(
  db: DbOrTx,
  opts: { brandId?: string; limit?: number } = {},
): Promise<FeaturedComparison[]> {
  const rows = await db.execute<{
    title: string;
    slugs: string[];
    names: string[];
    brand_names: string[];
  }>(sql`
    SELECT f.title,
           array_agg(p.slug ORDER BY p.slug) AS slugs,
           array_agg(p.name ORDER BY p.slug) AS names,
           array_agg(b.name ORDER BY p.slug) AS brand_names
    FROM featured_comparisons f
    JOIN products p ON p.id = ANY(f.product_ids) AND p.status = 'published'
    JOIN brands b ON b.id = p.brand_id AND b.is_active
    WHERE f.is_active
    GROUP BY f.id
    HAVING count(p.id) = cardinality(f.product_ids)
      ${opts.brandId ? sql`AND bool_or(p.brand_id = ${opts.brandId})` : sql``}
    ORDER BY min(f.sort_order), f.title
    LIMIT ${Math.min(opts.limit ?? 6, 24)}`);
  return rows.map((r) => ({
    title: r.title,
    path: comparisonPath(r.slugs),
    products: r.names.map((n, i) => ({ name: n, brandName: r.brand_names[i]! })),
  }));
}
