import "dotenv/config";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
test.afterAll(async () => {
  await sql.end();
});

test.describe("SEO and security", () => {
  test("pages carry a nonce CSP and the security headers", async ({ request }) => {
    for (const path of ["/", "/products/novik/aera-7-pro", "/admin/login"]) {
      const res = await request.get(path);
      const h = res.headers();
      expect(h["content-security-policy"], path).toMatch(
        /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
      );
      expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"], path).toContain("camera=()");
    }
    const a = (await request.get("/")).headers()["content-security-policy"];
    const b = (await request.get("/")).headers()["content-security-policy"];
    expect(a).not.toBe(b); // a fresh nonce per request
  });

  test("the app runs under the CSP without violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content.Security.Policy|Refused to (execute|load|apply)/i.test(m.text()))
        violations.push(m.text());
    });
    await page.goto("/");
    await page.getByRole("search").first().getByRole("combobox").fill("aera");
    // Client JS works under the CSP (search suggestions).
    await expect(page.getByRole("listbox", { name: "Search suggestions" }).first()).toBeVisible();
    await page.goto("/compare/aera-6-pro-vs-aera-7-pro");
    await page.goto("/admin/login");
    expect(violations).toEqual([]);
  });

  test("changed slugs, wrong brands and non-canonical comparisons answer 301", async ({
    request,
  }) => {
    await sql`INSERT INTO slug_redirects (entity_type, old_slug, new_slug) VALUES ('product', 'aera-7-pro-old', 'aera-7-pro')
              ON CONFLICT (entity_type, old_slug) DO UPDATE SET new_slug = EXCLUDED.new_slug`;
    const cases: [string, string][] = [
      [
        "/products/novik/aera-7-pro-old?variant=256gb-eu",
        "/products/novik/aera-7-pro?variant=256gb-eu",
      ],
      ["/products/halden/aera-7-pro", "/products/novik/aera-7-pro"],
      ["/compare/aera-7-pro-vs-aera-6-pro", "/compare/aera-6-pro-vs-aera-7-pro"],
    ];
    for (const [from, to] of cases) {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status(), from).toBe(301);
      const loc = new URL(res.headers()["location"]!, "http://x");
      expect(loc.pathname + loc.search, from).toBe(to);
    }
    expect((await request.get("/products/novik/aera-7-pro", { maxRedirects: 0 })).status()).toBe(
      200,
    );
  });

  test("robots.txt, sitemap and demo-mode indexing rules", async ({ request, page }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \/admin/);
    expect(robots).toMatch(/Disallow: \/go/);
    expect(robots).toMatch(/Sitemap: .*\/sitemap\/0\.xml/);
    const sitemap = await request.get("/sitemap/0.xml");
    expect(sitemap.status()).toBe(200);
    // Demo data is enabled for e2e: nothing is listed and every page is noindex.
    expect(await sitemap.text()).not.toContain("<loc>");
    await page.goto("/products/novik/aera-7-pro");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/products\/novik\/aera-7-pro$/,
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      /Novik Aera 7 Pro/,
    );
    // Demo records never get Product structured data; the homepage has Organization + WebSite.
    expect(await page.locator('script[type="application/ld+json"]').count()).toBe(0);
    await page.goto("/");
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld!)["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual([
      "Organization",
      "WebSite",
    ]);
    expect(ld).not.toMatch(/Review|AggregateRating/);
  });
});
