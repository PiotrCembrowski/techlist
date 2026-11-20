import { sql } from "drizzle-orm";
import type { DisplayOffer } from "./display";
import type { DbOrTx } from "@/lib/db";

export interface LowestOffer {
  productId: string;
  /** Lowest fresh, in-stock price in this market; null when the market is ALL (no cross-currency minimum). */
  price: string | null;
  currency: string | null;
  /** The offer behind `price` (for a /go/ link); null when there is no price. */
  offerId: string | null;
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
    offer_id: string | null;
  }>(sql`
    SELECT o.product_id,
           count(*)::int AS offer_count,
           count(DISTINCT o.market_country_code)::int AS market_count,
           (array_agg(o.price_amount::text ORDER BY o.price_amount) FILTER (WHERE o.availability_status <> 'out_of_stock'))[1] AS price,
           (array_agg(o.currency ORDER BY o.price_amount) FILTER (WHERE o.availability_status <> 'out_of_stock'))[1] AS currency,
           (array_agg(o.id::text ORDER BY o.price_amount) FILTER (WHERE o.availability_status <> 'out_of_stock'))[1] AS offer_id
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
      offerId: market === "ALL" ? null : r.offer_id,
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

/**
 * Displayable offers for a product page (active, unexpired, active retailer). With a variant
 * selected: that variant's offers plus offers not tied to a variant. Bounded to 100 rows.
 */
export async function getProductOffers(
  db: DbOrTx,
  productId: string,
  variantId: string | null,
): Promise<DisplayOffer[]> {
  const rows = await db.execute<{
    id: string;
    retailer_name: string;
    retailer_slug: string;
    market_country_code: string;
    currency: string;
    price_amount: string;
    original_price_amount: string | null;
    shipping_cost: string | null;
    availability_status: "in_stock" | "out_of_stock" | "preorder" | "unknown";
    condition: "new" | "used" | "refurbished";
    last_checked_at: string;
    expires_at: string | null;
    is_active: boolean;
    is_demo: boolean;
    variant_id: string | null;
    variant_name: string | null;
  }>(sql`
    SELECT o.id, r.name AS retailer_name, r.slug AS retailer_slug, o.market_country_code, o.currency,
           o.price_amount::text, o.original_price_amount::text, o.shipping_cost::text, o.availability_status,
           o.condition, o.last_checked_at::text, o.expires_at::text, o.is_active, o.is_demo,
           o.variant_id, v.variant_name
    FROM retailer_offers o
    JOIN retailers r ON r.id = o.retailer_id
    LEFT JOIN product_variants v ON v.id = o.variant_id
    WHERE o.product_id = ${productId}
      AND ${displayableOfferSql}
      ${variantId ? sql`AND (o.variant_id IS NULL OR o.variant_id = ${variantId})` : sql``}
    ORDER BY o.price_amount
    LIMIT 100`);
  return rows.map((r) => ({
    id: r.id,
    retailerName: r.retailer_name,
    retailerSlug: r.retailer_slug,
    marketCountryCode: r.market_country_code,
    currency: r.currency,
    priceAmount: r.price_amount,
    originalPriceAmount: r.original_price_amount,
    shippingCost: r.shipping_cost,
    availabilityStatus: r.availability_status,
    condition: r.condition,
    lastCheckedAt: new Date(r.last_checked_at),
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
    isActive: r.is_active,
    isDemo: r.is_demo,
    variantId: r.variant_id,
    variantName: r.variant_name,
  }));
}
