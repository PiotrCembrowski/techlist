import "dotenv/config";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
test.afterAll(async () => {
  await sql.end();
});

test.describe("Journey C: retailer shopping", () => {
  test("product page offer → /go redirect (302 to the configured demo URL) → click recorded", async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    await page.context().addCookies([{ name: "market", value: "PL", url: baseURL! }]);
    await page.goto("/products/novik/aera-7-pro");

    const offers = page.getByRole("region", { name: "Offers in Poland" });
    await expect(offers).toBeVisible();
    await expect(offers).toContainText("We may earn a commission");
    const row = offers
      .getByRole("listitem")
      .filter({ hasText: "Demo Retailer PL" })
      .filter({ hasText: "PLN 3,899.00" });
    await expect(row).toContainText("PL · PLN"); // market + currency
    await expect(row).toContainText("New");
    await expect(row).toContainText("In stock");
    await expect(row).toContainText(/\d+ h ago|\d+ min ago/); // last checked
    await expect(row).toContainText("Free shipping");
    await expect(row.getByText("Demo", { exact: true })).toBeVisible();

    const link = row.getByRole("link", { name: /Go to retailer/ });
    await expect(link).toHaveAttribute("rel", /sponsored/);
    await expect(link).toHaveAttribute("rel", /nofollow/);
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/go\/[0-9a-f-]{36}$/);

    // Stale offers are listed separately with a warning; other markets are collapsed.
    await expect(offers).toContainText("price last checked 5 days ago, may have changed");
    await expect(offers.locator("details")).not.toHaveAttribute("open", "");

    // Request the redirect without following it (never navigate to the external site).
    const refererHost = `journey-c-${testInfo.project.name}-${Date.now()}.example`;
    const res = await request.get(href!, {
      maxRedirects: 0,
      headers: { referer: `https://${refererHost}/page?q=private` },
    });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toBe(
      "https://shop.demo-retailer-pl.example/p/aera-7-pro?v=256gb-eu",
    );
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["x-robots-tag"]).toContain("noindex");

    const clicks = await sql<{ n: number; offer: string }[]>`
      SELECT count(*)::int AS n, min(offer_id::text) AS offer FROM affiliate_clicks WHERE referrer_host = ${refererHost}`;
    expect(clicks[0]!.n).toBe(1);
    expect(href).toBe(`/go/${clicks[0]!.offer}`);
  });

  test("tampered or unknown offer ids return 404 and record nothing", async ({ request }) => {
    const [offer] = await sql<{ id: string }[]>`
      SELECT o.id::text FROM retailer_offers o JOIN retailers r ON r.id = o.retailer_id
      WHERE r.slug = 'demo-retailer-de' AND o.is_active LIMIT 1`;
    const id = offer!.id;
    const tampered = id.slice(0, -1) + (id.endsWith("0") ? "1" : "0");
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM affiliate_clicks`;
    for (const bad of [tampered, "00000000-0000-4000-8000-000000000000", "not-a-uuid", `${id}x`]) {
      const res = await request.get(`/go/${bad}`, { maxRedirects: 0 });
      expect(res.status(), bad).toBe(404);
    }
    const expired = await sql<
      { id: string }[]
    >`SELECT id::text FROM retailer_offers WHERE expires_at < now() LIMIT 1`;
    expect((await request.get(`/go/${expired[0]!.id}`, { maxRedirects: 0 })).status()).toBe(404);
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM affiliate_clicks`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  test("a product without offers says so honestly", async ({ page }) => {
    await page.goto("/products/halden/pocket-3");
    await expect(page.getByRole("region", { name: "Offers" })).toContainText(
      "We don’t have current retailer offers for this product yet.",
    );
  });

  test("robots.txt disallows /go, /api, /search and /admin", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    for (const path of ["/go", "/api", "/search", "/admin"])
      expect(body).toContain(`Disallow: ${path}`);
  });
});
