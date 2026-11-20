export type OfferFreshness = "fresh" | "stale" | "expired" | "inactive";

export interface FreshnessInput {
  isActive: boolean;
  lastCheckedAt: Date;
  expiresAt: Date | null;
}

/**
 * SPEC §5.2: expired (expires_at < now) and inactive offers are never shown; stale offers
 * (last check older than OFFER_STALE_HOURS) are shown below fresh ones with a warning and are
 * excluded from "lowest price" and structured data.
 */
export function offerFreshness(
  o: FreshnessInput,
  staleHours: number,
  now: Date = new Date(),
): OfferFreshness {
  if (!o.isActive) return "inactive";
  if (o.expiresAt && o.expiresAt.getTime() < now.getTime()) return "expired";
  if (now.getTime() - o.lastCheckedAt.getTime() > staleHours * 3_600_000) return "stale";
  return "fresh";
}
