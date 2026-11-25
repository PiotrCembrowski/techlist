import { and, eq, isNull, or, sql } from "drizzle-orm";
import { products, productSpecifications } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { formatSpecValue } from "@/lib/format";
import type { PageLookup } from "@/modules/catalog/pages";
import { getProductGallery, type PublicImage } from "@/modules/media/public";
import { getIndexability, type Indexability } from "@/modules/seo/indexability";
import { productHref } from "@/modules/catalog/service";
import { getCategoryAncestors, type Category } from "@/modules/categories/service";
import { listGuidesForProduct, type GuideSummary } from "@/modules/guides/service";
import { resolveSlugRedirect } from "@/modules/slugs/service";
import {
  getEffectiveDefinitions,
  resolveVariantOverrides,
  type EffectiveDefinition,
} from "@/modules/specifications/service";
import { listVariants, type ProductVariant } from "@/modules/variants/service";
import type { Product } from "./service";

export const KEY_SPEC_COUNT = 6;

export interface SpecRow {
  key: string;
  label: string;
  description: string | null;
  /** null = no value stored -> "Not available" (distinct from a boolean "No"). */
  value: string | null;
  verified: boolean;
  isVariantOverride: boolean;
}

export interface SpecGroup {
  key: string;
  name: string;
  rows: SpecRow[];
}

export interface DataSourceSummary {
  name: string;
  type: string;
  url: string | null;
  retrievedAt: Date | null;
  isDemo: boolean;
}

export interface RelatedLink {
  slug: string;
  name: string;
  brandName: string;
  href: string;
  releaseDate: string | null;
}

export interface ProductPageData {
  product: Product;
  brand: { slug: string; name: string };
  categoryChain: Category[];
  variants: ProductVariant[];
  selectedVariant: ProductVariant | null;
  keySpecs: { key: string; label: string; value: string }[];
  specGroups: SpecGroup[];
  requiredCoverage: { present: number; required: number };
  predecessors: RelatedLink[];
  successors: RelatedLink[];
  alternativeIds: string[];
  relatedIds: string[];
  links: { type: string; url: string }[];
  sources: DataSourceSummary[];
  guides: GuideSummary[];
  images: PublicImage[];
  /** SPEC §12 rule for the canonical (variant-less) page. */
  indexability: Indexability;
}

function withVariant(path: string, variant: string | null | undefined) {
  return variant ? `${path}?variant=${encodeURIComponent(variant)}` : path;
}

/** Group spec rows for the full table: every public definition, values or "Not available". */
export function buildSpecGroups(
  defs: EffectiveDefinition[],
  resolved: ReturnType<typeof resolveVariantOverrides>,
): SpecGroup[] {
  const byDef = new Map(resolved.map((r) => [r.definition.id, r]));
  const groups: SpecGroup[] = [];
  for (const d of defs) {
    if (!d.isPublic) continue;
    const key = d.groupKey ?? "other";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, name: d.groupName ?? "Other", rows: [] };
      groups.push(g);
    }
    const r = byDef.get(d.id);
    g.rows.push({
      key: d.key,
      label: d.name,
      description: d.description,
      value: r ? formatSpecValue(d, r.value) : null,
      verified: r?.value.verificationStatus === "verified",
      isVariantOverride: r?.isVariantOverride ?? false,
    });
  }
  return groups;
}

export async function loadProductPage(
  db: DbOrTx,
  brandSlug: string,
  productSlug: string,
  variantCode?: string | null,
): Promise<PageLookup<ProductPageData>> {
  const [row] = await db.execute<{ id: string; brand_slug: string; brand_name: string }>(sql`
    SELECT p.id, b.slug AS brand_slug, b.name AS brand_name FROM products p JOIN brands b ON b.id = p.brand_id
    WHERE p.slug = ${productSlug} AND p.status = 'published' AND b.is_active`);
  if (!row) {
    const to = await resolveSlugRedirect(db, "product", productSlug);
    if (!to) return { kind: "not_found" };
    const [target] = await db.execute<{ brand_slug: string }>(sql`
      SELECT b.slug AS brand_slug FROM products p JOIN brands b ON b.id = p.brand_id
      WHERE p.slug = ${to} AND p.status = 'published' AND b.is_active`);
    return target
      ? { kind: "redirect", to: withVariant(productHref(target.brand_slug, to), variantCode) }
      : { kind: "not_found" };
  }
  if (row.brand_slug !== brandSlug) {
    return {
      kind: "redirect",
      to: withVariant(productHref(row.brand_slug, productSlug), variantCode),
    };
  }

  const [product] = await db.select().from(products).where(eq(products.id, row.id));
  if (!product) return { kind: "not_found" };
  const variants = (await listVariants(db, product.id)).filter((v) => v.status === "published");
  const selectedVariant =
    (variantCode && variants.find((v) => v.variantCode === variantCode)) || null;

  const [chain, defs, specRows, rels, links, sources, images] = await Promise.all([
    getCategoryAncestors(db, product.categoryId),
    getEffectiveDefinitions(db, product.categoryId),
    db
      .select()
      .from(productSpecifications)
      .where(
        and(
          eq(productSpecifications.productId, product.id),
          selectedVariant
            ? or(
                isNull(productSpecifications.variantId),
                eq(productSpecifications.variantId, selectedVariant.id),
              )
            : isNull(productSpecifications.variantId),
        ),
      ),
    db.execute<{
      direction: string;
      type: string;
      id: string;
      slug: string;
      name: string;
      brand_slug: string;
      brand_name: string;
      release_date: string | null;
    }>(sql`
      SELECT CASE WHEN r.source_product_id = ${product.id} THEN 'out' ELSE 'in' END AS direction,
             r.relationship_type AS type, p.id, p.slug, p.name, b.slug AS brand_slug, b.name AS brand_name, p.release_date::text
      FROM product_relationships r
      JOIN products p ON p.id = CASE WHEN r.source_product_id = ${product.id} THEN r.target_product_id ELSE r.source_product_id END
      JOIN brands b ON b.id = p.brand_id AND b.is_active
      WHERE (r.source_product_id = ${product.id} OR r.target_product_id = ${product.id})
        AND p.status = 'published'
      ORDER BY p.release_date DESC NULLS LAST, p.name
      LIMIT 48`),
    // Only links whose source permits display (SPEC §5.2).
    db.execute<{ link_type: string; url: string }>(sql`
      SELECT l.link_type, l.url FROM product_links l JOIN sources s ON s.id = l.source_id AND s.usage_permitted
      WHERE l.product_id = ${product.id} ORDER BY l.link_type LIMIT 20`),
    db.execute<{
      source_name: string;
      source_type: string;
      source_url: string | null;
      retrieved_at: string | null;
      is_demo: boolean;
    }>(sql`
      SELECT s.source_name, s.source_type, s.source_url, s.is_demo,
             greatest(max(r.retrieved_at), s.retrieved_at)::text AS retrieved_at
      FROM sources s
      LEFT JOIN product_source_records r ON r.source_id = s.id AND r.product_id = ${product.id}
      WHERE s.id IN (
        SELECT source_id FROM product_source_records WHERE product_id = ${product.id}
        UNION SELECT source_id FROM product_specifications WHERE product_id = ${product.id} AND source_id IS NOT NULL
      )
      GROUP BY s.id ORDER BY s.source_name LIMIT 20`),
    getProductGallery(db, product.id, selectedVariant?.id ?? null),
  ]);

  const resolved = resolveVariantOverrides(defs, specRows, selectedVariant?.id ?? null);
  const specGroups = buildSpecGroups(defs, resolved);
  const keySpecs = resolved
    .filter((r) => r.definition.isComparable && r.definition.isPublic)
    .slice(0, KEY_SPEC_COUNT)
    .map((r) => ({
      key: r.definition.key,
      label: r.definition.name,
      value: formatSpecValue(r.definition, r.value) ?? "",
    }))
    .filter((k) => k.value);
  const required = defs.filter((d) => d.isRequired);
  const present = required.filter((d) => resolved.some((r) => r.definition.id === d.id)).length;
  // Indexability uses product-level values only (the canonical page has no variant selected).
  const productLevelPresent = required.filter((d) =>
    specRows.some((r) => r.specificationDefinitionId === d.id && r.variantId === null),
  ).length;

  const link = (r: (typeof rels)[number]): RelatedLink => ({
    slug: r.slug,
    name: r.name,
    brandName: r.brand_name,
    href: productHref(r.brand_slug, r.slug),
    releaseDate: r.release_date,
  });
  const guides = await listGuidesForProduct(
    db,
    product.id,
    chain.map((c) => c.id),
    3,
  );

  return {
    kind: "ok",
    data: {
      product,
      brand: { slug: row.brand_slug, name: row.brand_name },
      categoryChain: chain,
      variants,
      selectedVariant,
      keySpecs,
      specGroups,
      requiredCoverage: { present, required: required.length },
      // Predecessor is derived: the source of a `successor` row that points at this product.
      predecessors: rels.filter((r) => r.type === "successor" && r.direction === "in").map(link),
      successors: rels.filter((r) => r.type === "successor" && r.direction === "out").map(link),
      alternativeIds: rels
        .filter((r) => r.type === "alternative" || r.type === "competitor")
        .map((r) => r.id),
      relatedIds: rels
        .filter((r) => ["related", "compatible_with", "accessory_for"].includes(r.type))
        .map((r) => r.id),
      links: links.map((l) => ({ type: l.link_type, url: l.url })),
      sources: sources.map((s) => ({
        name: s.source_name,
        type: s.source_type,
        url: s.source_url,
        retrievedAt: s.retrieved_at ? new Date(s.retrieved_at) : null,
        isDemo: s.is_demo,
      })),
      images,
      indexability: getIndexability({
        kind: "product",
        status: product.status,
        isDemo: product.isDemo,
        brandActive: true, // the lookup above only finds products of active brands
        requiredTotal: required.length,
        requiredPresent: productLevelPresent,
      }),
      guides,
    },
  };
}
