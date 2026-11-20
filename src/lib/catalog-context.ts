import "server-only";
import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { getSelectedMarket } from "@/lib/market/server";
import type { CatalogOptions } from "@/modules/catalog/service";
import { getMarketCurrencies } from "@/modules/offers/read";

/**
 * Per-request catalogue options: the selected market, the stale threshold, and the market's
 * currency when it has exactly one (price filter and price sort are offered only then, SPEC §6).
 */
export async function getCatalogOptions(): Promise<CatalogOptions> {
  const market = await getSelectedMarket();
  const currencies = await getMarketCurrencies(getDb(), market);
  return {
    market,
    staleHours: getEnv().OFFER_STALE_HOURS,
    priceCurrency: currencies.length === 1 ? currencies[0]! : null,
  };
}
