import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { contentSecurityPolicy, newNonce } from "@/lib/security/csp";
import { resolvePublicRedirect } from "@/modules/slugs/resolve";

/**
 * Runs before every page request (Node.js runtime):
 * 1. 301 for changed slugs, wrong brand segments and non-canonical comparison URLs (SPEC §12);
 * 2. a per-request CSP nonce (SPEC §13), passed to the app in the `x-nonce` request header.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (/^\/(products|brands|categories|guides|compare)\//.test(pathname)) {
    const to = await resolvePublicRedirect(getDb(), pathname);
    if (to) {
      const url = request.nextUrl.clone();
      url.pathname = to;
      url.search = search;
      return NextResponse.redirect(url, 301);
    }
  }

  const env = getEnv();
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, {
    dev: env.NODE_ENV === "development",
    https: env.SITE_URL.startsWith("https://"),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (env.SITE_URL.startsWith("https://")) {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: [
    // Pages only: not static files, images, uploaded media, API/redirect route handlers.
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|media/|api/|go/|sitemap|robots.txt).*)",
  ],
};
