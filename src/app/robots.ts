import type { MetadataRoute } from "next";
import { getEnv } from "@/config/env";

// Reads SITE_URL at request time; no database access.
export const dynamic = "force-dynamic";

/** SPEC §12: disallow admin, APIs, affiliate redirects and search results; point to the sitemap index. */
export default function robots(): MetadataRoute.Robots {
  const site = getEnv().SITE_URL;
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/go", "/search"] }],
    sitemap: new URL("/sitemap.xml", site).toString(),
    host: site,
  };
}
