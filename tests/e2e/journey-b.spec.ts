import { expect, test, type Page } from "@playwright/test";

/** Product column headers in the comparison table, in display order. */
async function columns(page: Page) {
  return page.locator("#comparison thead th[scope=col] a.font-heading").allInnerTexts();
}

function row(page: Page, label: string) {
  return page.locator("#comparison").getByRole("row", { name: new RegExp(`^${label}\\b`) });
}

test.describe("Journey B: comparison", () => {
  test("category page → add two → compare → add a third → remove one", async ({ page }) => {
    await page.goto("/categories/smartphones");
    await page.getByRole("button", { name: "Compare: Novik Aera 7 Pro" }).click();
    await page.getByRole("button", { name: "Compare: Corvala Strand S" }).click();
    const tray = page.getByRole("complementary", { name: "Comparison tray" });
    await expect(tray).toContainText("Compare 2/4");
    await expect(
      page.getByRole("button", { name: "In comparison: Novik Aera 7 Pro" }),
    ).toHaveAttribute("aria-pressed", "true");
    await tray.getByRole("link", { name: "Compare 2 products" }).click();

    // Side by side, canonical (alphabetical) URL.
    await expect(page).toHaveURL(/\/compare\/aera-7-pro-vs-strand-s$/);
    expect(await columns(page)).toEqual(["Aera 7 Pro", "Strand S"]);
    await expect(row(page, "RAM").getByRole("cell").nth(0)).toHaveText("12 GB");
    await expect(row(page, "RAM").getByRole("cell").nth(1)).toHaveText("Not available");

    // Add a third through the picker.
    const picker = page.getByRole("region", { name: "Add a product" });
    await picker.getByRole("searchbox").fill("pocket");
    await picker.getByRole("button", { name: "Add Halden Pocket 3 to comparison" }).click();
    await expect(page).toHaveURL(/\/compare\/aera-7-pro-vs-pocket-3-vs-strand-s$/);
    expect(await columns(page)).toEqual(["Aera 7 Pro", "Pocket 3", "Strand S"]);
    // The trailing empty cell sits under the "Add product" column (room for a fourth product).
    await expect(row(page, "Wireless charging").getByRole("cell")).toHaveText([
      "Yes",
      "No",
      "Not available",
      "",
    ]);

    // Remove one: URL and table update.
    await page.getByRole("link", { name: "Remove Novik Aera 7 Pro from comparison" }).click();
    await expect(page).toHaveURL(/\/compare\/pocket-3-vs-strand-s$/);
    expect(await columns(page)).toEqual(["Pocket 3", "Strand S"]);

    // The tray followed along (seen on any other page).
    await page.goto("/categories/smartphones");
    await expect(page.getByRole("complementary", { name: "Comparison tray" })).toContainText(
      "Compare 2/4",
    );
    await expect(page.getByRole("button", { name: "Compare: Novik Aera 7 Pro" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("differences are highlighted and can be shown alone", async ({ page }) => {
    await page.goto("/compare/aera-6-pro-vs-aera-7-pro");
    await expect(page.getByRole("status").first()).toContainText(
      /\d+ of \d+ specifications differ/,
    );
    await expect(row(page, "Battery capacity").getByRole("cell").nth(1)).toContainText("Highest");
    await expect(row(page, "Storage")).toBeVisible(); // identical row
    await page.getByLabel("Show only differences").check();
    await expect(row(page, "Storage")).toBeHidden();
    await expect(row(page, "Battery capacity")).toBeVisible();
  });

  test("non-canonical order redirects permanently; unknown products 404", async ({ request }) => {
    const r = await request.get("/compare/ridge-7800-vs-ridge-6800", { maxRedirects: 0 });
    expect(r.status()).toBe(301);
    expect(new URL(r.headers()["location"]!, "http://x").pathname).toBe(
      "/compare/ridge-6800-vs-ridge-7800",
    );
    expect((await request.get("/compare/ridge-7800-vs-nope")).status()).toBe(404);
    expect((await request.get("/compare/ridge-7800")).status()).toBe(404);
  });

  test("products from different categories get a clear message", async ({ page }) => {
    await page.goto("/compare/aera-7-pro-vs-vanta-14-2026");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "These products can’t be compared",
    );
    await expect(page.getByRole("heading", { name: "Smartphones" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Laptops" })).toBeVisible();
  });

  test("the tray refuses a product from another category without losing the comparison", async ({
    page,
  }) => {
    await page.goto("/products/novik/aera-7-pro");
    await page.getByRole("button", { name: "Add to compare" }).click();
    await page.goto("/products/halden/vanta-14-2026");
    await page.getByRole("button", { name: "Add to compare" }).click();
    const tray = page.getByRole("complementary", { name: "Comparison tray" });
    await expect(tray.getByRole("alert")).toContainText("Your comparison has Smartphones");
    await tray.getByRole("button", { name: "Keep current" }).click();
    await expect(tray).toContainText("Compare 1/4");
    await expect(tray).toContainText("Aera 7 Pro");
  });

  test("featured comparisons link to canonical comparison pages", async ({ page }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Featured comparisons" });
    await section.getByRole("link", { name: /Aera 7 Pro vs Aera 6 Pro/ }).click();
    await expect(page).toHaveURL(/\/compare\/aera-6-pro-vs-aera-7-pro$/);
    expect(await columns(page)).toEqual(["Aera 6 Pro", "Aera 7 Pro"]);
  });
});
