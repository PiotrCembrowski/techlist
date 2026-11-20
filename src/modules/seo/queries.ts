import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";

/**
 * Indexable products (SQL function `sb_indexable_products`, migrations 0003/0005 — the SQL form
 * of getIndexability's product rule) in a category subtree and/or for a brand.
 */
export async function countIndexableProducts(
  db: DbOrTx,
  scope: { categoryIds?: string[]; brandId?: string },
): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM sb_indexable_products(
      ${scope.categoryIds ? sql`${sql.param(scope.categoryIds)}::uuid[]` : sql`NULL`},
      ${scope.brandId ? sql`${scope.brandId}::uuid` : sql`NULL`})`);
  return Number(row?.n ?? 0);
}

/** Which of the given product ids are indexable. */
export async function indexableProductIds(db: DbOrTx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM sb_indexable_products(NULL, NULL, ${sql.param(ids.slice(0, 200))}::uuid[])`);
  return new Set(rows.map((r) => r.id));
}

/** Brands with at least one indexable product (the /brands listing is thin without them). */
export async function countBrandsWithIndexableProducts(db: DbOrTx): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`SELECT count(DISTINCT brand_id)::int AS n FROM indexable_products`,
  );
  return Number(row?.n ?? 0);
}
