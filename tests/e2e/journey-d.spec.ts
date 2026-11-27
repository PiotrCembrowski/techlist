import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./fixtures";

const UUID = "00000000-0000-4000-8000-000000000000";

/** Every admin page; each must send an anonymous visitor to the login page. */
const ADMIN_PATHS = [
  "/admin",
  "/admin/products",
  "/admin/products/new",
  `/admin/products/${UUID}`,
  `/admin/products/${UUID}/specs`,
  "/admin/brands",
  "/admin/brands/new",
  `/admin/brands/${UUID}`,
  "/admin/categories",
  "/admin/categories/new",
  `/admin/categories/${UUID}`,
  "/admin/retailers",
  "/admin/retailers/new",
  `/admin/retailers/${UUID}`,
  "/admin/offers",
  "/admin/offers/new",
  `/admin/offers/${UUID}`,
  "/admin/sources",
  "/admin/sources/new",
  `/admin/sources/${UUID}`,
  "/admin/users",
  "/admin/audit",
  "/admin/review",
  `/admin/review/${UUID}`,
  "/admin/imports",
  `/admin/imports/${UUID}`,
  "/admin/data-sources",
  // CSV downloads (route handlers)
  "/admin/imports/template?type=offers",
  "/admin/imports/export?type=products&category=laptops",
  `/admin/imports/${UUID}/errors`,
];

async function expectStatus(form: ReturnType<Page["getByRole"]>, text: string | RegExp) {
  await expect(form.getByRole("status")).toContainText(text);
}

test.describe("Journey D: administration", () => {
  test("anonymous requests to every admin page redirect to the login page", async ({ request }) => {
    for (const p of ADMIN_PATHS) {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status(), p).toBe(307);
      expect(res.headers()["location"], p).toMatch(/\/admin\/login$/);
    }
    const login = await request.get("/admin/login");
    expect(login.status()).toBe(200);
    expect(login.headers()["x-robots-tag"]).toContain("noindex");
    expect(login.headers()["x-frame-options"]).toBe("DENY");
  });

  test("wrong password is refused with a generic message", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill(E2E_ADMIN.email);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("Email or password is incorrect, or the account is inactive."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("log in → create product → variant → specs → source → publish → public page → log out", async ({
    page,
  }, testInfo) => {
    const name = `Testline ${testInfo.project.name} ${Date.now().toString(36)}`;

    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.getByLabel("Email").fill(E2E_ADMIN.email);
    await page.getByLabel("Password").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

    // Create a draft product.
    await page.goto("/admin/products/new");
    await page.getByLabel("Brand").selectOption({ label: "Novik" });
    await page.getByLabel("Category").selectOption({ label: "Laptops" });
    await page.getByLabel("Product name").fill(name);
    await page.getByLabel("Model number").fill(`TL-${Date.now().toString(36)}`);
    await page.getByLabel("Short summary").fill("A test laptop created by the end-to-end suite.");
    await page.getByLabel("Demonstration record").check();
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}\?created=1$/);
    const productUrl = page.url().replace(/\?.*$/, "");

    // Add a variant.
    const addVariant = page.getByRole("form", { name: "Add variant" });
    await addVariant.getByLabel("Name").fill("16 GB · 1 TB");
    await addVariant.getByLabel("Code").fill("16-1tb");
    await addVariant.getByRole("button", { name: "Add variant" }).click();
    await expectStatus(addVariant, "Variant added");
    await expect(page.getByRole("form", { name: "Variant 16 GB · 1 TB" })).toBeVisible();

    // Add specifications (units are parsed into canonical units).
    await page.getByRole("link", { name: "Edit specifications" }).click();
    const specs = page.getByRole("form", { name: "Specifications" });
    await specs.locator("#spec-processor").fill("Testcore T7");
    await specs.locator("#spec-ram").fill("16 GB");
    await specs.locator("#spec-storage").fill("1 TB");
    await specs.locator("#spec-screen_size").fill("14 in");
    await specs
      .getByLabel("Source for the values you change")
      .selectOption({ label: "Specbase demonstration research" });
    await specs.getByRole("button", { name: "Save specifications" }).click();
    await expectStatus(specs, "4 value(s) saved");
    await page.reload(); // stored in the canonical unit (GB)
    await expect(page.locator("#spec-storage")).toHaveValue("1000");

    // Record the source and publish.
    await page.goto(productUrl);
    const addSource = page.getByRole("form", { name: "Add source record" });
    await addSource
      .getByRole("combobox", { name: "Source", exact: true })
      .selectOption({ label: "Specbase demonstration research" });
    await addSource.getByLabel("Retrieved").fill("2026-11-01");
    await addSource.getByRole("button", { name: "Add source" }).click();
    await expectStatus(addSource, "Source recorded");
    await expect(page.getByRole("cell", { name: "Specbase demonstration research" })).toBeVisible();

    // A draft is published in one step ("verify & publish": the editor vouches for the data).
    const publish = page.getByRole("form", { name: "Verify & publish" });
    await publish.getByRole("button", { name: "Verify & publish" }).click();
    await expect(page.getByRole("form", { name: "Unpublish" })).toBeVisible();

    // The public page shows what was entered.
    const slug = (await page.getByLabel("URL slug").inputValue()).trim();
    await page.goto(`/products/novik/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("A test laptop created by the end-to-end suite.")).toBeVisible();
    const table = page.locator("main");
    await expect(table).toContainText("Testcore T7");
    await expect(table).toContainText("16 GB");
    await expect(table).toContainText("1 TB");
    await expect(table).toContainText("Specbase demonstration research");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/); // demo record

    // Log out; admin URLs go back to the login page.
    await page.goto("/admin");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    for (const p of ["/admin", "/admin/products", productUrl.replace(/^https?:\/\/[^/]+/, "")]) {
      await page.goto(p);
      await expect(page, p).toHaveURL(/\/admin\/login$/);
    }
  });
});
