import type { MetadataRoute } from "next";
import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { sitemapCount } from "@/modules/seo/sitemap";

export const dynamic = "force-dynamic";

/** SPEC §12: disallow admin, APIs, affiliate redirects and search results; list every sitemap file. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = getEnv().SITE_URL;
  const n = await sitemapCount(getDb());
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/go", "/search"] }],
    sitemap: Array.from({ length: n }, (_, id) => new URL(`/sitemap/${id}.xml`, site).toString()),
    host: site,
  };
}
