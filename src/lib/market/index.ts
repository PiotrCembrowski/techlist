import { marketSchema } from "@/lib/validation";

export const MARKET_COOKIE = "market";
export const DEFAULT_MARKET = "ALL";

/** Never geo-detected (SPEC §6): an absent or invalid cookie means ALL. */
export function parseMarket(value: string | undefined | null): string {
  const r = marketSchema.safeParse(value ?? "");
  return r.success ? r.data : DEFAULT_MARKET;
}
