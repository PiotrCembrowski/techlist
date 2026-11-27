import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { comparisonPath, parseComparisonParam } from "@/modules/comparisons/url";
import { resolveSlugRedirect } from "./service";

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const PRODUCT = new RegExp(`^/products/(${SLUG})/(${SLUG})/?$`);
const ENTITY = new RegExp(`^/(brands|categories|guides)/(${SLUG})/?$`);
const COMPARE = /^\/compare\/([^/]+)\/?$/;

/**
 * The permanent (301) redirect for a public URL, or null when the URL is current. Used by
 * src/proxy.ts so changed slugs, wrong brand segments and non-canonical comparison orders answer
 * 301 (SPEC §12). Pages keep their own checks as a fallback.
 */
export async function resolvePublicRedirect(db: DbOrTx, pathname: string): Promise<string | null> {
  const compare = COMPARE.exec(pathname);
  if (compare) {
    const parsed = parseComparisonParam(compare[1]!);
    return parsed.ok && !parsed.isCanonical ? comparisonPath(parsed.canonical) : null;
  }

  const product = PRODUCT.exec(pathname);
  if (product) {
    const [, brandSlug, productSlug] = product as unknown as [string, string, string];
    const current = await liveProductBrand(db, productSlug);
    if (current) return current === brandSlug ? null : `/products/${current}/${productSlug}`;
    const to = await resolveSlugRedirect(db, "product", productSlug);
    if (!to) return null;
    const target = await liveProductBrand(db, to);
    return target ? `/products/${target}/${to}` : null;
  }

  const entity = ENTITY.exec(pathname);
  if (entity) {
    const [, section, slug] = entity as unknown as ["", "brands" | "categories" | "guides", string];
    const live = await db.execute<{ n: number }>(
      section === "brands"
        ? sql`SELECT 1 AS n FROM brands WHERE slug = ${slug} AND is_active`
        : section === "categories"
          ? sql`SELECT 1 AS n FROM categories WHERE slug = ${slug} AND is_active`
          : sql`SELECT 1 AS n FROM guides WHERE slug = ${slug} AND publication_status = 'published'`,
    );
    if (live.length) return null;
    const type = section === "brands" ? "brand" : section === "categories" ? "category" : "guide";
    const to = await resolveSlugRedirect(db, type, slug);
    return to && to !== slug ? `/${section}/${to}` : null;
  }
  return null;
}

async function liveProductBrand(db: DbOrTx, productSlug: string): Promise<string | null> {
  const [row] = await db.execute<{ brand_slug: string }>(sql`
    SELECT b.slug AS brand_slug FROM products p JOIN brands b ON b.id = p.brand_id AND b.is_active
    WHERE p.slug = ${productSlug} AND p.status = 'published'`);
  return row?.brand_slug ?? null;
}
