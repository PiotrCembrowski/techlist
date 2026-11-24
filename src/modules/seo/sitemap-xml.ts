import type { SitemapEntry } from "./sitemap";

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** `<urlset>` for one sitemap file (absolute URLs, optional lastmod). */
export function urlsetXml(siteUrl: string, entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const loc = escapeXml(new URL(e.path, siteUrl).toString());
      const lastmod = e.lastModified ? `<lastmod>${e.lastModified.toISOString()}</lastmod>` : "";
      return `<url><loc>${loc}</loc>${lastmod}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** `<sitemapindex>` listing `/sitemaps/0.xml` … `/sitemaps/{count-1}.xml`. */
export function sitemapIndexXml(siteUrl: string, count: number): string {
  const items = Array.from(
    { length: count },
    (_, i) =>
      `<sitemap><loc>${escapeXml(new URL(`/sitemaps/${i}.xml`, siteUrl).toString())}</loc></sitemap>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}

export function xmlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
