import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";

export interface CatalogStats {
  products: number;
  brands: number;
  markets: number;
  verifiedLast7Days: number;
}

/** Real counts from the database for the homepage index panel (published records only). */
export async function getCatalogStats(db: DbOrTx): Promise<CatalogStats> {
  const [row] = await db.execute<{
    products: number;
    brands: number;
    markets: number;
    verified: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM products WHERE status = 'published') AS products,
      (SELECT count(DISTINCT brand_id)::int FROM products WHERE status = 'published') AS brands,
      (SELECT count(DISTINCT o.market_country_code)::int FROM retailer_offers o
         JOIN products p ON p.id = o.product_id AND p.status = 'published'
        WHERE o.is_active AND (o.expires_at IS NULL OR o.expires_at > now())) AS markets,
      (SELECT count(*)::int FROM products WHERE status = 'published'
         AND last_verified_at > now() - interval '7 days') AS verified`);
  return {
    products: Number(row?.products ?? 0),
    brands: Number(row?.brands ?? 0),
    markets: Number(row?.markets ?? 0),
    verifiedLast7Days: Number(row?.verified ?? 0),
  };
}
