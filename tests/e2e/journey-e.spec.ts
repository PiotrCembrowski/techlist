import "dotenv/config";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { adminLogin } from "./helpers";

const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
test.afterAll(async () => {
  await sql.end();
});

const SAMPLE = readFileSync("docs/samples/products-import-sample.csv", "utf8");

/** Each project imports its own copy (distinct names, model numbers and GTINs) so runs don't collide. */
function sampleFor(project: string) {
  if (project === "admin-desktop")
    return { csv: SAMPLE, model: "NK14-2609", duplicate: "Aera 7 Pro Max" };
  const csv = SAMPLE.replaceAll("Kestrel 14", "Wren 12")
    .replaceAll("NK14-2609", "NW12-2609")
    .replace("2009000000018", "2009000000032")
    .replace("2009000000025", "2009000000049")
    .replace("Aera 7 Pro Max", "Aera 7 Pro Ultra");
  return { csv, model: "NW12-2609", duplicate: "Aera 7 Pro Ultra" };
}

async function upload(page: Page, csv: string) {
  await page.goto("/admin/imports");
  const form = page.getByRole("form", { name: "New import" });
  await form.getByRole("combobox", { name: "Type" }).selectOption("products");
  await form
    .getByRole("combobox", { name: "Source of the data" })
    .selectOption({ label: "Specbase demonstration research" });
  await form
    .getByLabel("CSV file")
    .setInputFiles({ name: "products-sample.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await form.getByRole("button", { name: "Upload and map columns" }).click();
  await expect(page).toHaveURL(/\/admin\/imports\/[0-9a-f-]{36}$/);
  // Columns were auto-mapped by header name.
  await expect(page.getByRole("combobox", { name: "spec.ram" })).toHaveValue("spec.ram");
  await page.getByRole("button", { name: "Validate rows" }).click();
  await expect(page.getByRole("navigation", { name: "Rows by action" })).toBeVisible();
}

const counts = (page: Page) => page.getByRole("navigation", { name: "Rows by action" });

test.describe("Journey E: CSV import", () => {
  test.describe.configure({ mode: "serial" });

  test("upload → preview with errors and a duplicate → commit → error report → re-import creates nothing", async ({
    page,
  }, testInfo) => {
    const { csv, model, duplicate } = sampleFor(testInfo.project.name);
    page.on("dialog", (d) => d.accept());
    await adminLogin(page);

    await upload(page, csv);
    await expect(counts(page)).toContainText("Create: 2");
    await expect(counts(page)).toContainText("Error: 2");
    await expect(counts(page)).toContainText("Conflict: 1");

    // Validation errors per row.
    await counts(page).getByRole("link", { name: "Error: 2" }).click();
    const preview = page.getByRole("table").last();
    await expect(preview).toContainText('Unknown brand "Vexmoor"');
    await expect(preview).toContainText("release_date");
    // The likely duplicate is held back, not merged.
    await counts(page).getByRole("link", { name: "Conflict: 1" }).click();
    await expect(page.getByRole("table").last()).toContainText("Possible duplicate of Aera 7 Pro");

    await page.getByRole("button", { name: "Commit import" }).click();
    await expect(page.getByRole("status")).toContainText("Import committed: 2 rows applied");
    const [product] = await sql<
      { id: string; status: string }[]
    >`SELECT id, status FROM products WHERE model_number = ${model}`;
    expect(product?.status).toBe("needs_review");
    expect(
      (await sql`SELECT 1 FROM product_variants WHERE product_id = ${product!.id}`).length,
    ).toBe(2);

    // Error report download.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: /Download error report/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("products-sample-errors.csv");
    const report = readFileSync((await download.path())!, "utf8");
    expect(report.split("\r\n")[0]).toMatch(/^row_number,action,problems,brand,/);
    expect(report).toContain("Vexmoor");
    expect(report).toContain(duplicate);

    // The same file again: nothing new.
    const before =
      await sql`SELECT (SELECT count(*) FROM products)::int AS p, (SELECT count(*) FROM product_variants)::int AS v,
                                    (SELECT count(*) FROM product_specifications)::int AS s, (SELECT count(*) FROM review_items)::int AS r`;
    await upload(page, csv);
    await expect(counts(page)).toContainText("Create: 0");
    await expect(counts(page)).toContainText("Skip: 2");
    await page.getByRole("button", { name: "Commit import" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Import committed: 0 rows applied, 2 skipped",
    );
    const after =
      await sql`SELECT (SELECT count(*) FROM products)::int AS p, (SELECT count(*) FROM product_variants)::int AS v,
                                   (SELECT count(*) FROM product_specifications)::int AS s, (SELECT count(*) FROM review_items)::int AS r`;
    expect(after[0]).toEqual(before[0]);
  });

  test("the review queue resolves the duplicate candidate", async ({ page }, testInfo) => {
    const { duplicate } = sampleFor(testInfo.project.name);
    await adminLogin(page);
    await page.goto("/admin/review?type=duplicate_candidate");
    await page
      .getByRole("row")
      .filter({ hasText: duplicate })
      .getByRole("link", { name: /^Review/ })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Possible duplicate", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText(duplicate);
    const reject = page.getByRole("form", { name: "Reject" });
    await reject.getByRole("textbox", { name: "Reason" }).fill("Not a real product variant");
    await reject.getByRole("button", { name: "Discard the row" }).click();
    await expect(page).toHaveURL(/\/admin\/review\?done=rejected/);
    await expect(page.getByRole("status")).toContainText("Item rejected");
  });
});
