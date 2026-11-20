import type { MetadataRoute } from "next";
import { getEnv } from "@/config/env";

/** SPEC §12: disallow admin, APIs, affiliate redirects and search results. Sitemap arrives in Stage 7. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/go", "/search"] }],
    host: getEnv().SITE_URL,
  };
}
