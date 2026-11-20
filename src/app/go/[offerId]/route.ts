import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { MARKET_COOKIE } from "@/lib/market";
import { recordAffiliateClick, resolveOfferRedirect } from "@/modules/offers/redirect";

export const dynamic = "force-dynamic";

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Robots-Tag": "noindex, nofollow",
};

/**
 * Affiliate redirect (SPEC §11). The target is always the URL stored on the offer — never a URL
 * from the request — and its host must be in the retailer's allowlist. Anything else is a 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const db = getDb();
  const result = await resolveOfferRedirect(db, offerId, {
    demoEnabled: getEnv().ENABLE_DEMO_DATA,
  });

  if (!result.ok) {
    if (result.reason === "unsafe_url" || result.reason === "host_not_allowed") {
      // Misconfigured offer data: worth an operator's attention. No personal data is logged.
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "affiliate redirect refused",
          reason: result.reason,
          offerId,
        }),
      );
    }
    return new NextResponse("Not found", {
      status: 404,
      headers: { ...BASE_HEADERS, "Content-Type": "text/plain" },
    });
  }

  await recordAffiliateClick(db, {
    offerId: result.redirect.offerId,
    market: req.cookies.get(MARKET_COOKIE)?.value ?? null,
    referer: req.headers.get("referer"),
    userAgent: req.headers.get("user-agent"),
  });

  return new NextResponse(null, {
    status: 302,
    headers: { ...BASE_HEADERS, Location: result.redirect.url },
  });
}

/** HEAD must not count as a click (link checkers, previews). */
export function HEAD() {
  return new NextResponse(null, { status: 405, headers: { ...BASE_HEADERS, Allow: "GET" } });
}
