import { expect, test } from "@playwright/test";

test.describe("Stage 1 smoke", () => {
  test("homepage renders the shell, demo banner and live catalogue counts", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Discover. Compare. Choose smarter." }),
    ).toBeVisible();
    await expect(page.getByRole("note", { name: "Demonstration data" })).toContainText("fictional");
    await expect(page.getByRole("link", { name: "Specbase home" })).toBeVisible();
    // Counts come from the seeded database (22 demo products, 4 brands).
    const index = page.getByRole("complementary", { name: "Catalogue index" });
    await expect(index.getByText("Products")).toBeVisible();
    await expect(index.locator("dd").first()).toHaveText("22");
    await expect(page.getByRole("contentinfo")).toContainText("Affiliate disclosure");
    // Demo data is never indexed.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("theme toggle switches to dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.getByRole("button", { name: "Switch between light and dark theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(29, 31, 32)");
  });

  test("unknown routes return a real 404 page", async ({ page }) => {
    const response = await page.goto("/this-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("health endpoint reports the database as reachable", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  test("no horizontal scroll at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
