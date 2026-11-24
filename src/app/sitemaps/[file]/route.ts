import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { SITEMAP_LIMIT, sitemapCount, sitemapEntries } from "@/modules/seo/sitemap";
import { urlsetXml, xmlResponse } from "@/modules/seo/sitemap-xml";

export const dynamic = "force-dynamic";

/** One sitemap file: `/sitemaps/0.xml`, `/sitemaps/1.xml`, … (indexable records only). */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const m = /^(\d{1,6})\.xml$/.exec((await params).file);
  if (!m) return new Response("Not found", { status: 404 });
  const id = Number(m[1]);
  const db = getDb();
  if (id >= (await sitemapCount(db, SITEMAP_LIMIT)))
    return new Response("Not found", { status: 404 });
  return xmlResponse(urlsetXml(getEnv().SITE_URL, await sitemapEntries(db, id, SITEMAP_LIMIT)));
}
