/**
 * Import Center happy path with the SYNTHETIC fixture provider (offline, demo mode only):
 * switch on → confirm licence → map → search preview → import → review → publish.
 * The worker runs as its own process (`pnpm worker --drain`), as in production.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { adminLogin } from "./helpers";

const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
// Its own client address: admin sign-ins are rate limited per address and email.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.77" } });

test.afterAll(async () => {
  await sql.end();
});

function runWorker() {
  execFileSync("pnpm", ["-s", "worker", "--drain", "--max-minutes", "2"], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      ENABLE_DEMO_DATA: "true",
      FIXTURE_PROVIDER: "true",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-test-secret-not-for-production-use-0000",
    },
    stdio: "pipe",
    timeout: 120_000,
  });
}

async function expectStatus(f: ReturnType<Page["getByRole"]>, text: string) {
  await expect(f.getByRole("status")).toContainText(text);
}

async function form(page: Page, name: string) {
  const f = page.getByRole("form", { name });
  await expect(f).toBeVisible();
  return f;
}

test("Import Center: preview, import, review and publish a product", async ({ page }, info) => {
  // Stateful (shared test database): run once, in the desktop admin project.
  test.skip(info.project.name !== "admin-desktop", "runs once");
  test.setTimeout(240_000);
  await adminLogin(page);

  // 1. Switch the provider on.
  await page.goto("/admin/import-center");
  const row = page.getByRole("row", { name: /Synthetic fixture data/ });
  await row.getByRole("button", { name: "Switch on" }).click();
  await expect(page.getByText("Confirm its licence on the Sources page")).toBeVisible();

  // 2. Confirm the licence of its source.
  await page.goto("/admin/sources");
  await page.getByRole("link", { name: "Synthetic fixture data (demo only)" }).click();
  await page.getByLabel("Usage is permitted").check();
  await page.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByRole("status")).toBeVisible();

  // 3. Map the provider's category and one feature to ours.
  await page.goto("/admin/import-center/mappings?provider=fixture");
  const cat = await form(page, "Map a category");
  await cat.getByLabel("Provider category ID").fill("fixture-phones");
  await cat.getByLabel("Our category").selectOption({ label: "Smartphones" });
  await cat.getByRole("button", { name: "Save category mapping" }).click();
  await expectStatus(cat, "Mapping saved");
  const feat = await form(page, "Map a feature");
  await feat.getByLabel("Provider feature ID or name").fill("FIX-storage");
  await feat.getByLabel("Specification").selectOption({ label: "Smartphones › Storage (GB)" });
  await feat.getByRole("button", { name: "Save feature mapping" }).click();
  await expectStatus(feat, "Mapping saved");

  // 4. Preview a search.
  await page.goto("/admin/import-center/discover");
  const find = await form(page, "Find products");
  await find.getByRole("combobox", { name: /^Provider/ }).selectOption("fixture");
  await find.getByLabel("Search text").fill("novik lumen");
  await find.getByRole("button", { name: "Queue" }).click();
  await expect(page).toHaveURL(/\/admin\/import-center\/jobs\/[0-9a-f-]{36}\?queued=1$/);
  const previewUrl = page.url();
  runWorker();
  await page.goto(previewUrl);
  const preview = await form(page, "Import from preview");
  await expect(preview.getByRole("row", { name: /Novik Lumen 5 FIX-1001/ })).toBeVisible();
  await expect(preview).toContainText("storage: 128");
  const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM products`;

  // 5. Import the first two records (two configurations of one model).
  for (const box of await preview.getByRole("checkbox").all()) await box.uncheck();
  await preview
    .getByRole("checkbox", { name: /Import Novik Novik Lumen 5$/ })
    .first()
    .check();
  await preview
    .getByRole("checkbox", { name: /Import Novik Novik Lumen 5$/ })
    .nth(1)
    .check();
  await preview.getByRole("button", { name: "Import selected" }).click();
  await expect(page).toHaveURL(/\?queued=1$/);
  expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM products`)[0]!.n).toBe(
    before[0]!.n,
  );
  runWorker();
  await page.reload();
  await expect(page.getByRole("region", { name: "Job items" })).toContainText("applied");

  const [product] = await sql<{ id: string; slug: string; status: string }[]>`
    SELECT p.id, p.slug, p.status FROM products p JOIN product_identifiers i ON i.product_id = p.id
    WHERE i.identifier_type = 'provider_product_id' AND i.value = 'FIX-1001'`;
  expect(product!.status).toBe("needs_review");
  const variants = await sql`SELECT 1 FROM product_variants WHERE product_id = ${product!.id}`;
  expect(variants.length).toBe(2);
  // Not public before review.
  expect((await page.request.get(`/products/novik/${product!.slug}`)).status()).toBe(404);

  // 6. Review: verify and publish.
  const [item] = await sql<{ id: string }[]>`
    SELECT id FROM review_items WHERE item_type = 'new_product' AND entity_id = ${product!.id} AND status = 'open'`;
  await page.goto(`/admin/review/${item!.id}`);
  await page
    .getByRole("form", { name: "Approve" })
    .getByRole("button", { name: "Verify and publish" })
    .click();
  await expect(page.getByRole("status")).toBeVisible();

  // 7. Public page shows the imported data.
  await page.goto(`/products/novik/${product!.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: /Lumen 5/ })).toBeVisible();
  await expect(page.locator("main")).toContainText("128 GB");
  await expect(page.locator("main")).toContainText("Synthetic fixture data (demo only)");
});
