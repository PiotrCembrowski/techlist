import { readFileSync } from "node:fs";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  priceHistory,
  products,
  productSpecifications,
  productVariants,
  retailerOffers,
  reviewItems,
  sources,
} from "@/db/schema";
import { seedDemoData } from "@/db/seed";
import { parseCsv, writeCsv } from "@/lib/csv";
import { closeDb } from "@/lib/db";
import { exportOffersCsv, exportProductsCsv, productsTemplateCsv } from "@/modules/imports/export";
import {
  commitImportJob,
  countImportRows,
  createImportJob,
  importErrorReportCsv,
  listImportRows,
  setImportMapping,
  validateImportJob,
} from "@/modules/imports/service";
import { createSource } from "@/modules/sources/service";
import { ctx, db, truncateAll } from "./helpers";

const SAMPLE = readFileSync("docs/samples/products-import-sample.csv", "utf8");
const csvFile = (text: string, name = "file.csv") => new File([text], name, { type: "text/csv" });
let sourceId: string;

async function runImport(text: string, type: "products" | "offers" = "products") {
  const job = await createImportJob(ctx(), { importType: type, sourceId, file: csvFile(text) });
  await validateImportJob(ctx(), job.id);
  const preview = await countImportRows(db(), job.id);
  const result = await commitImportJob(ctx(), job.id);
  return { job, preview, result };
}

async function tableCounts() {
  const c = async (
    table:
      | typeof products
      | typeof productVariants
      | typeof productSpecifications
      | typeof reviewItems
      | typeof retailerOffers
      | typeof priceHistory,
  ) => Number((await db().select({ n: count() }).from(table))[0]!.n);
  return {
    products: await c(products),
    variants: await c(productVariants),
    specs: await c(productSpecifications),
    reviews: await c(reviewItems),
    offers: await c(retailerOffers),
    history: await c(priceHistory),
  };
}

beforeAll(async () => {
  await truncateAll();
  await seedDemoData(db());
  const [demo] = await db()
    .select()
    .from(sources)
    .where(eq(sources.sourceName, "Specbase demonstration research"));
  sourceId = demo!.id;
});
afterAll(closeDb);

describe("products import: the sample file", () => {
  let firstJobId: string;

  it("previews creates, errors and a duplicate candidate without touching the catalogue", async () => {
    const before = await tableCounts();
    const job = await createImportJob(ctx(), {
      importType: "products",
      sourceId,
      file: csvFile(SAMPLE, "sample.csv"),
    });
    expect(job.columnMapping["spec.ram"]).toBe("spec.ram");
    expect(job.columnMapping["memory"]).toBe("memory");
    await validateImportJob(ctx(), job.id);
    expect(await countImportRows(db(), job.id)).toEqual({
      create: 2,
      update: 0,
      skip: 0,
      conflict: 1,
      error: 2,
    });
    expect(await tableCounts()).toEqual(before);

    const errors = (await listImportRows(db(), job.id, { action: "error" })).items;
    expect(errors.map((r) => r.rowNumber)).toEqual([4, 5]);
    expect(errors[0]!.errors).toContainEqual(
      expect.objectContaining({
        field: "brand",
        message: expect.stringMatching(/Unknown brand "Vexmoor"/),
      }),
    );
    expect(errors[1]!.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["release_date"]));
    const [conflict] = (await listImportRows(db(), job.id, { action: "conflict" })).items;
    expect(conflict!.rowNumber).toBe(6);
    expect((conflict!.normalized as { notes: string[] }).notes.join()).toMatch(
      /Possible duplicate of Aera 7 Pro/,
    );
    firstJobId = job.id;
  });

  it("commits valid rows: one draft product with two variants, specs at the right scope, review items", async () => {
    const result = await commitImportJob(ctx(), firstJobId);
    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 0, conflicts: 1, errors: 2 });
    const [kestrel] = await db()
      .select()
      .from(products)
      .where(eq(products.modelNumber, "NK14-2609"));
    expect(kestrel).toMatchObject({
      name: "Kestrel 14",
      publicationStatus: "draft",
      isDemo: true,
      releaseDate: "2026-09-01",
    });
    const variants = await db()
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, kestrel!.id));
    expect(
      variants.map((v) => [v.variantCode, v.regionCode, v.barcodeGtin, v.isDefault]).sort(),
    ).toEqual([
      ["16-512", "EU", "2009000000018", true],
      ["32-1tb", "EU", "2009000000025", false],
    ]);
    const specs = await db().execute<{
      key: string;
      variant_id: string | null;
      value_numeric: string | null;
      value_text: string | null;
      origin: string;
      verification_status: string;
    }>(sql`
      SELECT d.key, s.variant_id, s.value_numeric::text, s.value_text, s.origin, s.verification_status
      FROM product_specifications s JOIN specification_definitions d ON d.id = s.specification_definition_id
      WHERE s.product_id = ${kestrel!.id} ORDER BY d.key, s.value_numeric`);
    // Same value on every variant → product level; differing values → each variant.
    const scope = (k: string) =>
      specs
        .filter((s) => s.key === k)
        .map((s) => [
          s.variant_id === null ? "product" : "variant",
          s.value_numeric ?? s.value_text,
        ]);
    expect(scope("processor")).toEqual([["product", "Kestrel K5"]]);
    expect(scope("screen_size")).toEqual([["product", "14"]]);
    expect(scope("ram")).toEqual([
      ["variant", "16"],
      ["variant", "32"],
    ]);
    expect(scope("storage")).toEqual([
      ["variant", "512"],
      ["variant", "1000"],
    ]);
    expect(
      specs.every((s) => s.origin === "import" && s.verification_status === "unverified"),
    ).toBe(true);

    const items = await db().select().from(reviewItems);
    expect(
      items.filter((i) => i.itemType === "new_product" && i.entityId === kestrel!.id),
    ).toHaveLength(1);
    const dup = items.find((i) => i.itemType === "duplicate_candidate");
    expect(dup?.payload).toMatchObject({
      rowNumber: 6,
      candidates: [expect.objectContaining({ name: "Aera 7 Pro" })],
    });

    const report = await importErrorReportCsv(db(), firstJobId);
    const parsed = parseCsv(report.csv);
    expect(parsed[0]!.slice(0, 3)).toEqual(["row_number", "action", "problems"]);
    expect(parsed.slice(1).map((r) => r[0])).toEqual(["4", "5", "6"]);
    expect(report.fileName).toBe("sample-errors.csv");
  });

  it("re-importing the same file creates zero new records", async () => {
    const before = await tableCounts();
    const { preview, result } = await runImport(SAMPLE);
    expect(preview).toEqual({ create: 0, update: 0, skip: 2, conflict: 1, error: 2 });
    expect(result).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 2,
      conflicts: 1,
      errors: 2,
      reviewItems: 0,
    });
    expect(await tableCounts()).toEqual(before);
  });
});

describe("export → import round trips", () => {
  it("re-importing exported products changes nothing (formula guard and units included)", async () => {
    for (const category of ["laptops", "smartphones", "gaming-laptops", "headphones"]) {
      const csv = await exportProductsCsv(db(), category);
      expect(csv.split("\r\n")[0]).toContain("spec.");
      const before = await tableCounts();
      const { preview } = await runImport(csv);
      expect(preview, category).toMatchObject({ create: 0, update: 0, conflict: 0, error: 0 });
      expect(await tableCounts()).toEqual(before);
    }
  });

  it("re-importing exported offers changes nothing", async () => {
    const csv = await exportOffersCsv(db(), null);
    const before = await tableCounts();
    const { preview } = await runImport(csv, "offers");
    expect(preview).toMatchObject({ create: 0, update: 0, conflict: 0, error: 0 });
    expect(preview.skip).toBeGreaterThan(5);
    expect(await tableCounts()).toEqual(before);
  });

  it("an offer price change updates the offer and appends price history", async () => {
    const rows = parseCsv(await exportOffersCsv(db(), "demo-retailer-pl"));
    const [header, first] = rows as [string[], string[]];
    const priceCol = header.indexOf("price");
    const changed = [...first];
    changed[priceCol] = String(Number(first[priceCol]) + 10);
    const before = await tableCounts();
    const { preview, result } = await runImport(writeCsv([header, changed]), "offers");
    expect(preview).toMatchObject({ update: 1 });
    expect(result.updated).toBe(1);
    const after = await tableCounts();
    expect(after.history).toBe(before.history + 1);
    expect(after.offers).toBe(before.offers);
  });
});

describe("protection rules", () => {
  it("never overwrites a verified value: queues one review item, even on re-import", async () => {
    const [verified] = await db().execute<{
      product_id: string;
      key: string;
      model: string;
      brand: string;
      category: string;
    }>(sql`
      SELECT s.product_id, d.key, p.model_number AS model, b.name AS brand, c.slug AS category
      FROM product_specifications s JOIN specification_definitions d ON d.id = s.specification_definition_id
      JOIN products p ON p.id = s.product_id JOIN brands b ON b.id = p.brand_id JOIN categories c ON c.id = p.category_id
      WHERE s.verification_status = 'verified' AND s.variant_id IS NULL AND d.data_type = 'text'
        AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id) LIMIT 1`);
    expect(verified).toBeTruthy();
    const csv = writeCsv([
      ["brand", "category_slug", "product_name", "model_number", `spec.${verified!.key}`],
      [
        verified!.brand,
        verified!.category,
        (await db().select().from(products).where(eq(products.id, verified!.product_id)))[0]!.name,
        verified!.model,
        "Changed by import",
      ],
    ]);
    const openConflicts = async () =>
      Number(
        (
          await db()
            .select({ n: count() })
            .from(reviewItems)
            .where(
              sql`${reviewItems.itemType} = 'conflicting_value' AND ${reviewItems.status} = 'open'`,
            )
        )[0]!.n,
      );
    const before = await openConflicts();
    const first = await runImport(csv);
    expect(first.result.reviewItems).toBe(1);
    expect(await openConflicts()).toBe(before + 1);
    const [value] = await db().execute<{ value_text: string; verification_status: string }>(sql`
      SELECT s.value_text, s.verification_status FROM product_specifications s JOIN specification_definitions d ON d.id = s.specification_definition_id
      WHERE s.product_id = ${verified!.product_id} AND d.key = ${verified!.key} AND s.variant_id IS NULL`);
    expect(value).toMatchObject({ verification_status: "verified" });
    expect(value!.value_text).not.toBe("Changed by import");
    await runImport(csv);
    expect(await openConflicts()).toBe(before + 1);
  });

  it("does not merge a regional variant into another region's variant", async () => {
    const rows = parseCsv(await exportProductsCsv(db(), "laptops"));
    const [header] = rows;
    const regionCol = header!.indexOf("region_code");
    const row = rows.find((r, i) => i > 0 && r[regionCol] === "EU")!;
    expect(row).toBeTruthy();
    const changed = [...row];
    changed[regionCol] = "US";
    const job = await createImportJob(ctx(), {
      importType: "products",
      sourceId,
      file: csvFile(writeCsv([header!, changed])),
    });
    await validateImportJob(ctx(), job.id);
    const [r] = (await listImportRows(db(), job.id)).items;
    expect(r!.action).toBe("conflict");
    expect((r!.normalized as { conflict: { type: string } }).conflict.type).toBe(
      "variant_ambiguity",
    );
  });

  it("refuses bad files, unpermitted sources and invalid mappings", async () => {
    const up = (file: File, src = sourceId) =>
      createImportJob(ctx(), { importType: "products", sourceId: src, file });
    await expect(up(new File(["a,b"], "data.xlsx"))).rejects.toThrow(/Only .csv/);
    await expect(
      up(new File([new Uint8Array([0x62, 0x72, 0x61, 0x6e, 0x64, 0x0a, 0xff, 0xfe])], "x.csv")),
    ).rejects.toThrow(/UTF-8/);
    await expect(up(csvFile("brand\n" + "Novik\n".repeat(10_001)))).rejects.toThrow(
      /more than 10000 rows/,
    );
    await expect(up(csvFile("brand,category_slug\n"))).rejects.toThrow(/no data rows/);
    const blocked = await createSource(ctx(), {
      sourceName: "Unlicensed catalogue",
      sourceType: "licensed_provider",
      usagePermitted: false,
    });
    await expect(up(csvFile(SAMPLE), blocked.id)).rejects.toThrow(/does not permit/);

    const job = await up(csvFile("Marke,Kategorie,Name\nNovik,laptops,X\n"));
    expect(Object.values(job.columnMapping).filter(Boolean)).toEqual(["product_name"]);
    await expect(validateImportJob(ctx(), job.id)).rejects.toThrow(/Map a column to "brand"/);
    await setImportMapping(ctx(), job.id, {
      Marke: "brand",
      Kategorie: "category_slug",
      Name: "product_name",
    });
    await validateImportJob(ctx(), job.id);
    expect((await countImportRows(db(), job.id)).create).toBe(1);
    await expect(
      setImportMapping(ctx(), job.id, { Marke: "brand", Kategorie: "brand", Name: "product_name" }),
    ).rejects.toThrow(/mapped twice/);
  });

  it("cannot commit twice", async () => {
    const job = await createImportJob(ctx(), {
      importType: "products",
      sourceId,
      file: csvFile(SAMPLE),
    });
    await validateImportJob(ctx(), job.id);
    await commitImportJob(ctx(), job.id);
    await expect(commitImportJob(ctx(), job.id)).rejects.toThrow(/Validate the import/);
  });

  it("templates list the category's specification columns", async () => {
    const header = parseCsv(await productsTemplateCsv(db(), "gaming-laptops"))[0]!;
    expect(header.slice(0, 3)).toEqual(["brand", "category_slug", "product_name"]);
    expect(header).toEqual(expect.arrayContaining(["spec.ram", "spec.gpu_power"])); // inherited + own
  });
});
