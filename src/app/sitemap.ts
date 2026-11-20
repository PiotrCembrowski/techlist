import type { MetadataRoute } from "next";
import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { sitemapCount, sitemapEntries } from "@/modules/seo/sitemap";

// Built per request from the database (never at build time).
export const dynamic = "force-dynamic";

/** SPEC §12: indexable records only, split into files of at most 50,000 URLs. */
export async function generateSitemaps() {
  const n = await sitemapCount(getDb());
  return Array.from({ length: n }, (_, id) => ({ id }));
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);
  if (!Number.isInteger(id) || id < 0) return [];
  const site = getEnv().SITE_URL;
  const entries = await sitemapEntries(getDb(), id);
  return entries.map((e) => ({
    url: new URL(e.path, site).toString(),
    ...(e.lastModified ? { lastModified: e.lastModified } : {}),
  }));
}
