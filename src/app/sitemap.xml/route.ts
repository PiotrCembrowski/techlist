import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { sitemapCount } from "@/modules/seo/sitemap";
import { sitemapIndexXml, xmlResponse } from "@/modules/seo/sitemap-xml";

// Queried per request, never at build time (the build machine may not reach the database).
export const dynamic = "force-dynamic";

/** SPEC §12: the sitemap index; each file holds at most 50,000 indexable URLs. */
export async function GET() {
  const n = await sitemapCount(getDb());
  return xmlResponse(sitemapIndexXml(getEnv().SITE_URL, n));
}
