import { offerFreshness, type OfferFreshness } from "./freshness";

export interface DisplayOffer {
  id: string;
  retailerName: string;
  retailerSlug: string;
  marketCountryCode: string;
  currency: string;
  priceAmount: string;
  originalPriceAmount: string | null;
  shippingCost: string | null;
  availabilityStatus: "in_stock" | "out_of_stock" | "preorder" | "unknown";
  condition: "new" | "used" | "refurbished";
  lastCheckedAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
  isDemo: boolean;
  variantId: string | null;
  variantName: string | null;
}

export interface OfferWithState extends DisplayOffer {
  freshness: Extract<OfferFreshness, "fresh" | "stale">;
}

export interface MarketOffers {
  market: string;
  fresh: OfferWithState[];
  stale: OfferWithState[];
}

export interface GroupedOffers {
  /** The selected market's offers (or every market when "All markets" is selected). */
  primary: MarketOffers[];
  /** Offers outside the selected market, shown collapsed. Empty when the market is ALL. */
  otherMarkets: MarketOffers[];
  total: number;
}

const AVAILABILITY_RANK: Record<DisplayOffer["availabilityStatus"], number> = {
  in_stock: 0,
  preorder: 1,
  unknown: 2,
  out_of_stock: 3,
};

/**
 * Order inside a group: buyable first (in stock, then preorder, unknown, out of stock), then by
 * currency (amounts in different currencies are never compared) and price, then retailer name.
 * The order never depends on commissions.
 */
export function compareOffers(a: DisplayOffer, b: DisplayOffer): number {
  return (
    AVAILABILITY_RANK[a.availabilityStatus] - AVAILABILITY_RANK[b.availabilityStatus] ||
    a.currency.localeCompare(b.currency) ||
    Number(a.priceAmount) - Number(b.priceAmount) ||
    a.retailerName.localeCompare(b.retailerName)
  );
}

function byMarket(offers: OfferWithState[]): MarketOffers[] {
  const map = new Map<string, MarketOffers>();
  for (const o of offers) {
    const g = map.get(o.marketCountryCode) ?? { market: o.marketCountryCode, fresh: [], stale: [] };
    g[o.freshness].push(o);
    map.set(o.marketCountryCode, g);
  }
  for (const g of map.values()) {
    g.fresh.sort(compareOffers);
    g.stale.sort(compareOffers);
  }
  return [...map.values()].sort((a, b) => a.market.localeCompare(b.market));
}

/**
 * SPEC §5.2 / §7.6: expired and inactive offers are never shown; stale offers are listed below
 * fresh ones with a warning; offers for the selected market come first and other markets are
 * grouped (collapsed) with their market clearly labelled.
 */
export function groupOffers(
  offers: DisplayOffer[],
  market: string,
  staleHours: number,
  now: Date = new Date(),
): GroupedOffers {
  const visible: OfferWithState[] = [];
  for (const o of offers) {
    const f = offerFreshness(o, staleHours, now);
    if (f === "fresh" || f === "stale") visible.push({ ...o, freshness: f });
  }
  if (market === "ALL")
    return { primary: byMarket(visible), otherMarkets: [], total: visible.length };
  return {
    primary: byMarket(visible.filter((o) => o.marketCountryCode === market)),
    otherMarkets: byMarket(visible.filter((o) => o.marketCountryCode !== market)),
    total: visible.length,
  };
}

/** Whole days since the last check, for "Price last checked X days ago". */
export function daysSince(date: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}
