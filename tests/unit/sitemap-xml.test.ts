import { describe, expect, it } from "vitest";
import { sitemapIndexXml, urlsetXml } from "@/modules/seo/sitemap-xml";

describe("sitemap XML", () => {
  it("writes absolute, escaped URLs with optional lastmod", () => {
    const xml = urlsetXml("https://specs.example", [
      { path: "/products/novik/aera-7-pro", lastModified: new Date("2026-11-20T10:00:00Z") },
      { path: "/compare/a-vs-b?x=1&y=2", lastModified: null },
    ]);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(
      "<loc>https://specs.example/products/novik/aera-7-pro</loc><lastmod>2026-11-20T10:00:00.000Z</lastmod>",
    );
    expect(xml).toContain("<loc>https://specs.example/compare/a-vs-b?x=1&amp;y=2</loc></url>");
  });
  it("lists every sitemap file in the index", () => {
    const xml = sitemapIndexXml("https://specs.example", 2);
    expect(xml).toContain("<sitemapindex");
    expect(xml.match(/<sitemap>/g)).toHaveLength(2);
    expect(xml).toContain("<loc>https://specs.example/sitemaps/1.xml</loc>");
  });
});
