import type { MetadataRoute } from "next";
import { getEnv } from "@/config/env";

// Reads SITE_URL at request time; no database access.
export const dynamic = "force-dynamic";

/**
 * Crawlers that collect content for AI model training (not search indexing). Open Icecat's Fair
 * Use Policy asks licensees to exclude them, and its licence (OCL §10) forbids training on the data
 * (DECISIONS D82). AI *search* crawlers (e.g. OAI-SearchBot, PerplexityBot) are not listed: they
 * are not training crawlers. Each token is the one its operator documents for robots.txt.
 */
export const AI_TRAINING_CRAWLERS = [
  "GPTBot",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "ClaudeBot",
  "anthropic-ai",
  "Bytespider",
  "meta-externalagent",
] as const;

/**
 * SPEC §12: disallow admin, APIs, affiliate redirects and search results; point to the sitemap
 * index. AI-training crawlers are disallowed everywhere.
 */
export default function robots(): MetadataRoute.Robots {
  const site = getEnv().SITE_URL;
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/go", "/search"] },
      { userAgent: [...AI_TRAINING_CRAWLERS], disallow: "/" },
    ],
    sitemap: new URL("/sitemap.xml", site).toString(),
    host: site,
  };
}
