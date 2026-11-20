import { expect, test, type Page } from "@playwright/test";

/** The value cell of a spec-table row, found by its <th scope="row"> label. */
function specValue(page: Page, label: string) {
  return page.getByRole("row", { name: new RegExp(`^${label}\\b`) }).getByRole("cell");
}

test.describe("Journey A: discovery", () => {
  test("homepage → search by model number → results → product page → spec table", async ({
    page,
  }) => {
    await page.goto("/");
    const search = page.getByRole("search").first().getByRole("combobox");
    await search.fill("NA7P-2611");
    await search.press("Enter");

    await expect(page).toHaveURL(/\/search\?q=NA7P-2611/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("NA7P-2611");
    const exact = page.getByRole("region", { name: "Exact model number match" });
    await expect(exact).toBeVisible();
    await exact.getByRole("link", { name: /Novik Aera 7 Pro/ }).click();

    await expect(page).toHaveURL(/\/products\/novik\/aera-7-pro$/);
    await expect(page.getByRole("heading", { level: 1, name: "Aera 7 Pro" })).toBeVisible();
    await expect(page.getByText("NA7P-2611").first()).toBeVisible();
    await expect(page.getByText("Verified · 12 Nov 2026").first()).toBeVisible();
    await expect(specValue(page, "Screen size")).toHaveText("6.7″");
    await expect(specValue(page, "Storage")).toHaveText("256 GB");
    await expect(specValue(page, "Battery capacity")).toHaveText("5,000 mAh");
    await expect(specValue(page, "Wireless charging")).toHaveText("Yes");
    await expect(specValue(page, "Operating system")).toHaveText("Aster OS");
  });

  test("search suggestions are keyboard-navigable", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("search").first().getByRole("combobox");
    await search.fill("vanta");
    const list = page.getByRole("listbox", { name: "Search suggestions" }).first();
    await expect(list.getByRole("option", { name: /Halden Vanta 14 \(2026\)/ })).toBeVisible();
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", /.+/);
    await search.press("Enter");
    await expect(page).toHaveURL(/\/products\/halden\/vanta-14-20(25|26)$/);
  });

  test("an unknown query gets a useful empty state", async ({ page }) => {
    await page.goto("/search?q=zzzzqqq");
    await expect(page.getByRole("heading", { name: /Nothing matched/ })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Browse by category" })
        .getByRole("link", { name: "Laptops" }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});

test.describe("Catalogue", () => {
  test("category filters are generated per category and live in the URL", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/categories/laptops");
    await expect(page.getByRole("heading", { level: 1, name: "Laptops" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("5 products");
    if (isMobile) await page.locator("summary", { hasText: "Filters" }).click();
    const form = page.getByRole("form", { name: "Filters" }).locator("visible=true");
    await form.getByRole("group", { name: "RAM (GB)" }).getByLabel("Min").fill("32");
    await form.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/\/categories\/laptops\?s\.ram\.min=32$/); // empty fields are dropped
    await expect(page.getByRole("status")).toContainText("2 products");
    await expect(page.getByRole("link", { name: "Strand G16" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Vanta 14 (2026)" })).toBeVisible();
    // No GPU filters on headphone pages.
    await page.goto("/categories/headphones");
    await expect(page.locator('[name="s.vram.min"]')).toHaveCount(0);
    await expect(page.locator('[name="s.noise_cancelling"]').first()).toBeAttached();
  });

  test("variant selector updates the URL and the variant's specs", async ({ page }) => {
    await page.goto("/products/novik/aera-7-pro");
    await page
      .getByRole("navigation", { name: "Variants" })
      .getByRole("link", { name: "1 TB · US" })
      .click();
    await expect(page).toHaveURL(/\?variant=1tb-us$/);
    await expect(specValue(page, "Storage")).toContainText("1 TB");
    await expect(specValue(page, "RAM")).toContainText("16 GB");
  });

  test("a product with missing data says so honestly", async ({ page }) => {
    await page.goto("/products/corvala/strand-s");
    await expect(page.getByText("Needs review").first()).toBeVisible();
    await expect(specValue(page, "RAM")).toHaveText("Not available");
  });

  test("wrong brand slug redirects permanently; unknown product is a 404", async ({ request }) => {
    const r = await request.get("/products/halden/aera-7-pro", { maxRedirects: 0 });
    expect(r.status()).toBe(301);
    expect(new URL(r.headers()["location"]!, "http://x").pathname).toBe(
      "/products/novik/aera-7-pro",
    );
    expect((await request.get("/products/novik/does-not-exist")).status()).toBe(404);
  });

  test("market selector shows prices in that market's original currency", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/categories/smartphones");
    if (isMobile) {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("dialog").getByLabel("Market").selectOption("PL");
      // The sheet stays open after choosing; the page behind it is aria-hidden until it closes.
      await page.getByRole("button", { name: "Close menu" }).click();
    } else {
      await page.getByRole("banner").getByLabel("Market").selectOption("PL");
    }
    await expect(page.getByRole("status")).toContainText("offers for Poland");
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("link", { name: "Aera 7 Pro" }) });
    await expect(card).toContainText("PLN 3,349.00");
    await expect(
      page.getByRole("navigation", { name: "Sort" }).getByRole("link", { name: "Lowest price" }),
    ).toBeVisible();
  });

  test("navigation reaches categories, brands, guides and static pages", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/");
    if (isMobile) {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("dialog").getByRole("link", { name: "Brands" }).click();
    } else {
      await page.getByRole("button", { name: "Categories" }).click();
      await expect(page.getByRole("link", { name: "Gaming laptops" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Brands" })
        .click();
    }
    await expect(page).toHaveURL(/\/brands$/);
    await page
      .getByRole("link", { name: /Halden/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Halden" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Discontinued models" })).toBeVisible();

    await page.goto("/guides");
    await page.getByRole("link", { name: /How much phone storage/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "How much phone storage do you need?" }),
    ).toBeVisible();

    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Data & verification policy" })
      .click();
    await expect(page.getByRole("heading", { name: "Verification statuses" })).toBeVisible();
  });
});
