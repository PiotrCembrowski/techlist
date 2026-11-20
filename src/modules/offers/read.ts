import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";

export interface LowestOffer {
  productId: string;
  /** Lowest fresh, in-stock price in this market; null when the market is ALL (no cross-currency minimum). */
  price: string | null;
  currency: string | null;
  /** Fresh, displayable offers counted for the card line. */
  offerCount: number;
  marketCount: number;
}

/**
 * SQL predicate for offers that may be displayed at all (active, not expired, active retailer).
 * Used by every public offer query so the rules live in one place.
 */
export const displayableOfferSql = sql`o.is_active AND (o.expires_at IS NULL OR o.expires_at > now())
  AND EXISTS (SELECT 1 FROM retailers r WHERE r.id = o.retailer_id AND r.is_active)`;

export const freshOfferSql = (staleHours: number) =>
  sql`${displayableOfferSql} AND o.last_checked_at >= now() - make_interval(hours => ${staleHours})`;

/**
 * Lowest fresh offer per product for one market, plus fresh offer counts. One query for a whole
 * page of products (no N+1). Out-of-stock offers count as offers but never set the "from" price.
 */
export async function getLowestFreshOffers(
  db: DbOrTx,
  productIds: string[],
  market: string,
  staleHours: number,
): Promise<Map<string, LowestOffer>> {
  const out = new Map<string, LowestOffer>();
  if (productIds.length === 0) return out;
  const marketFilter = market === "ALL" ? sql`TRUE` : sql`o.market_country_code = ${market}`;
  const rows = await db.execute<{
    product_id: string;
    offer_count: number;
    market_count: number;
    price: string | null;
    currency: string | null;
  }>(sql`
    SELECT o.product_id,
           count(*)::int AS offer_count,
           count(DISTINCT o.market_country_code)::int AS market_count,
           (array_agg(o.price_amount::text ORDER BY o.price_amount) FILTER (WHERE o.availability_status <> 'out_of_stock'))[1] AS price,
           (array_agg(o.currency ORDER BY o.price_amount) FILTER (WHERE o.availability_status <> 'out_of_stock'))[1] AS currency
    FROM retailer_offers o
    WHERE o.product_id = ANY(${sql.param(productIds)}::uuid[])
      AND ${freshOfferSql(staleHours)}
      AND ${marketFilter}
    GROUP BY o.product_id`);
  for (const r of rows) {
    out.set(r.product_id, {
      productId: r.product_id,
      offerCount: Number(r.offer_count),
      marketCount: Number(r.market_count),
      price: market === "ALL" ? null : r.price,
      currency: market === "ALL" ? null : r.currency,
    });
  }
  return out;
}

/** Markets that have at least one displayable offer or a retailer, for the market selector. */
export async function listMarkets(db: DbOrTx): Promise<string[]> {
  const rows = await db.execute<{ code: string }>(sql`
    SELECT code FROM (
      SELECT o.market_country_code AS code FROM retailer_offers o WHERE ${displayableOfferSql}
      UNION
      SELECT country_code FROM retailers WHERE is_active
    ) m ORDER BY code LIMIT 250`);
  return rows.map((r) => r.code);
}

/**
 * Currencies used by displayable offers in a market. The price filter is only offered when
 * there is exactly one (SPEC §6: no cross-currency comparison without conversion).
 */
export async function getMarketCurrencies(db: DbOrTx, market: string): Promise<string[]> {
  if (market === "ALL") return [];
  const rows = await db.execute<{ currency: string }>(sql`
    SELECT DISTINCT o.currency FROM retailer_offers o
    WHERE o.market_country_code = ${market} AND ${displayableOfferSql}
    ORDER BY 1 LIMIT 10`);
  return rows.map((r) => r.currency);
}
