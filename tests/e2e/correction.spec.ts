import "dotenv/config";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
test.afterAll(async () => {
  await sql.end();
});

test("a reader suggests a correction from the product page", async ({ page }, testInfo) => {
  await page.goto("/products/novik/hush-4");
  await page.getByRole("link", { name: "Suggest a correction" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Suggest a correction" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const form = page.getByRole("form", { name: "Suggest a correction" });
  const value = `Battery 31 h (${testInfo.project.name})`;
  await form.getByRole("textbox", { name: "Correct value" }).fill(value);
  await form
    .getByRole("textbox", { name: "Where is it published?" })
    .fill("https://maker.example/hush-4/specs");
  await form.getByRole("button", { name: "Send correction" }).click();
  await expect(form.getByRole("status")).toContainText("An editor will check your correction");
  const rows =
    await sql`SELECT payload FROM review_items WHERE item_type = 'correction' AND payload->>'value' = ${value}`;
  expect(rows).toHaveLength(1);
});
