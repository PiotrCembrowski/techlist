import { sql } from "drizzle-orm";
import { affiliateClicks } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { marketSchema, uuidSchema } from "@/lib/validation";

export type RedirectRejection =
  | "invalid_id"
  | "not_found"
  | "inactive"
  | "expired"
  | "retailer_inactive"
  | "product_unavailable"
  | "demo_disabled"
  | "unsafe_url"
  | "host_not_allowed";

/**
 * A redirect target is only ever a URL stored on the offer, never one taken from the request.
 * It must be https, carry no credentials or non-default port, and its host must be listed
 * exactly (case-insensitive) in the retailer's allowed_redirect_hosts.
 */
export function validateRedirectTarget(
  rawUrl: string,
  allowedHosts: string[],
): { ok: true; url: string } | { ok: false; reason: "unsafe_url" | "host_not_allowed" } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "unsafe_url" };
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    return { ok: false, reason: "unsafe_url" };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = new Set(
    allowedHosts.map((h) => h.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean),
  );
  if (!allowed.has(host)) return { ok: false, reason: "host_not_allowed" };
  return { ok: true, url: url.toString() };
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|headless|python-requests|curl\/|wget|httpclient|go-http-client|java\/|okhttp|axios|node-fetch|scrapy|phantomjs/i;

/** Simple user-agent keyword check; the user agent itself is never stored. */
export function isProbableBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim() === "") return true;
  return BOT_PATTERN.test(userAgent);
}

/** Host only (never the full URL, path or query) from a Referer header. */
export function referrerHost(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase();
    return host && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

export interface ResolvedRedirect {
  offerId: string;
  url: string;
}

/**
 * Loads an offer and decides whether /go/[offerId] may redirect (SPEC §11). The offer must be
 * active, unexpired, its retailer active, its product published; demo offers only redirect when
 * demo data is enabled.
 */
export async function resolveOfferRedirect(
  db: DbOrTx,
  offerId: string,
  opts: { demoEnabled: boolean },
): Promise<{ ok: true; redirect: ResolvedRedirect } | { ok: false; reason: RedirectRejection }> {
  if (!uuidSchema.safeParse(offerId).success) return { ok: false, reason: "invalid_id" };
  const [row] = await db.execute<{
    id: string;
    product_url: string;
    affiliate_url: string | null;
    is_active: boolean;
    expired: boolean;
    is_demo: boolean;
    retailer_active: boolean;
    allowed_redirect_hosts: string[];
    product_published: boolean;
  }>(sql`
    SELECT o.id, o.product_url, o.affiliate_url, o.is_active, (o.expires_at IS NOT NULL AND o.expires_at < now()) AS expired,
           o.is_demo, r.is_active AS retailer_active, r.allowed_redirect_hosts,
           (p.status = 'published') AS product_published
    FROM retailer_offers o
    JOIN retailers r ON r.id = o.retailer_id
    JOIN products p ON p.id = o.product_id
    WHERE o.id = ${offerId}`);
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.is_active) return { ok: false, reason: "inactive" };
  if (row.expired) return { ok: false, reason: "expired" };
  if (!row.retailer_active) return { ok: false, reason: "retailer_inactive" };
  if (!row.product_published) return { ok: false, reason: "product_unavailable" };
  if (row.is_demo && !opts.demoEnabled) return { ok: false, reason: "demo_disabled" };
  const target = validateRedirectTarget(
    row.affiliate_url ?? row.product_url,
    row.allowed_redirect_hosts ?? [],
  );
  if (!target.ok) return { ok: false, reason: target.reason };
  return { ok: true, redirect: { offerId: row.id, url: target.url } };
}

/** Records a click without IP addresses or user agents (SPEC §5.2 affiliate_clicks). */
export async function recordAffiliateClick(
  db: DbOrTx,
  input: {
    offerId: string;
    market: string | null;
    referer: string | null;
    userAgent: string | null;
  },
) {
  const market = marketSchema.safeParse(input.market ?? "");
  await db.insert(affiliateClicks).values({
    offerId: input.offerId,
    marketCountryCode: market.success ? market.data : null,
    referrerHost: referrerHost(input.referer),
    isProbableBot: isProbableBot(input.userAgent),
  });
}
