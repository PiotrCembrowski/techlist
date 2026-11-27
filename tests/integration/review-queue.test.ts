import { count, eq, ne, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
import { CORRECTION_LIMIT, submitCorrection } from "@/modules/corrections/service";
import { exportProductsCsv } from "@/modules/imports/export";
import {
  commitImportJob,
  countImportRows,
  createImportJob,
  validateImportJob,
} from "@/modules/imports/service";
import { updateRetailerOffer } from "@/modules/offers/service";
import {
  approveReviewItem,
  listReviewItems,
  rejectReviewItem,
} from "@/modules/review-queue/service";
import { setSpecificationValue } from "@/modules/specifications/service";
import { ctx, db, makeProduct, truncateAll } from "./helpers";

let sourceId: string;
const file = (rows: string[][]) => new File([writeCsv(rows)], "rows.csv", { type: "text/csv" });

async function runImport(rows: string[][]) {
  const job = await createImportJob(ctx(), { importType: "products", sourceId, file: file(rows) });
  await validateImportJob(ctx(), job.id);
  const preview = await countImportRows(db(), job.id);
  const result = await commitImportJob(ctx(), job.id);
  return { preview, result };
}

async function openItem(type: string, where = sql`TRUE`) {
  const [item] = await db()
    .select()
    .from(reviewItems)
    .where(sql`${reviewItems.itemType} = ${type} AND ${reviewItems.status} = 'open' AND ${where}`)
    .orderBy(sql`${reviewItems.createdAt} DESC`)
    .limit(1);
  return item!;
}

async function productId(slug: string) {
  return (await db().select().from(products).where(eq(products.slug, slug)))[0]!.id;
}

beforeAll(async () => {
  await truncateAll();
  await seedDemoData(db());
  sourceId = (
    await db()
      .select()
      .from(sources)
      .where(eq(sources.sourceName, "Specbase demonstration research"))
  )[0]!.id;
});
afterAll(closeDb);

describe("specification items", () => {
  it("approving a conflicting value replaces the verified value and keeps it verified; edit-then-approve works", async () => {
    const pid = await productId("aera-7-pro");
    const [spec] = await db().execute<{ id: string; key: string }>(sql`
      SELECT s.id, d.key FROM product_specifications s JOIN specification_definitions d ON d.id = s.specification_definition_id
      WHERE s.product_id = ${pid} AND s.variant_id IS NULL AND s.verification_status = 'verified' AND d.key = 'battery_capacity'`);
    const r = await setSpecificationValue(ctx(), {
      productId: pid,
      key: spec!.key,
      value: "5100 mAh",
      origin: "manual",
      verificationStatus: "unverified",
    });
    expect(r.outcome).toBe("review_required");
    const item = await openItem("conflicting_value", sql`${reviewItems.entityId} = ${spec!.id}`);
    await approveReviewItem(ctx(), item.id, { value: "5150 mAh", note: "Checked the data sheet" });
    const [after] = await db()
      .select()
      .from(productSpecifications)
      .where(eq(productSpecifications.id, spec!.id));
    expect(Number(after!.valueNumeric)).toBe(5150);
    expect(after!.verificationStatus).toBe("verified");
    await expect(approveReviewItem(ctx(), item.id)).rejects.toThrow(/already been resolved/);
  });

  it("rejecting an AI-extracted value removes it; approving verifies it", async () => {
    const [phones] = await db().execute<{ id: string }>(
      sql`SELECT id FROM categories WHERE slug = 'smartphones'`,
    );
    const p = await makeProduct({ categoryId: phones!.id });
    await setSpecificationValue(ctx(), {
      productId: p.id,
      key: "wireless_charging",
      value: "no",
      origin: "ai_extracted",
      confidence: 0.4,
    });
    const first = await openItem("unverified_spec");
    await expect(rejectReviewItem(ctx(), first.id, " ")).rejects.toThrow(/Say why/);
    await rejectReviewItem(ctx(), first.id, "Contradicts the manufacturer page");
    expect(
      await db()
        .select()
        .from(productSpecifications)
        .where(eq(productSpecifications.id, first.entityId!)),
    ).toHaveLength(0);

    await setSpecificationValue(ctx(), {
      productId: p.id,
      key: "wireless_charging",
      value: "yes",
      origin: "ai_extracted",
      confidence: 0.9,
    });
    const item = await openItem("unverified_spec");
    await approveReviewItem(ctx(), item.id);
    const [spec] = await db()
      .select()
      .from(productSpecifications)
      .where(eq(productSpecifications.id, item.entityId!));
    expect(spec).toMatchObject({ verificationStatus: "verified", valueBoolean: true });
  });
});

describe("offers and products", () => {
  it("rejecting a suspicious price hides the offer", async () => {
    // An offer whose product has another fresh, active offer in the same currency.
    const [pick] = await db().execute<{ id: string }>(sql`
      SELECT o.id FROM retailer_offers o WHERE o.is_active AND EXISTS (
        SELECT 1 FROM retailer_offers x WHERE x.product_id = o.product_id AND x.currency = o.currency AND x.id <> o.id
          AND x.is_active AND (x.expires_at IS NULL OR x.expires_at > now()) AND x.last_checked_at > now() - interval '72 hours')
      LIMIT 1`);
    const [offer] = await db().select().from(retailerOffers).where(eq(retailerOffers.id, pick!.id));
    // Ten times the price is far from the median of the product's other offers.
    const { suspicious } = await updateRetailerOffer(ctx(), offer!.id, {
      priceAmount: Number(offer!.priceAmount) * 10,
    });
    expect(suspicious).toBe(true);
    const item = await openItem("suspicious_price", sql`${reviewItems.entityId} = ${offer!.id}`);
    await rejectReviewItem(ctx(), item.id, "Typo in the feed");
    expect(
      (await db().select().from(retailerOffers).where(eq(retailerOffers.id, offer!.id)))[0]!
        .isActive,
    ).toBe(false);
  });

  it("approving a new imported product publishes it; rejecting archives it", async () => {
    await runImport([
      ["brand", "category_slug", "product_name", "model_number", "is_demo"],
      ["Novik", "headphones", "Murmur 1", "NK-MM1", "true"],
      ["Novik", "headphones", "Murmur 2", "NK-MM2", "true"],
    ]);
    const [m1] = await db().select().from(products).where(eq(products.modelNumber, "NK-MM1"));
    const [m2] = await db().select().from(products).where(eq(products.modelNumber, "NK-MM2"));
    await approveReviewItem(
      ctx(),
      (await openItem("new_product", sql`${reviewItems.entityId} = ${m1!.id}`)).id,
    );
    await rejectReviewItem(
      ctx(),
      (await openItem("new_product", sql`${reviewItems.entityId} = ${m2!.id}`)).id,
      "Not a real product line",
    );
    const [a] = await db().select().from(products).where(eq(products.id, m1!.id));
    const [b] = await db().select().from(products).where(eq(products.id, m2!.id));
    expect(a).toMatchObject({ status: "published" });
    expect(a!.lastVerifiedAt).toBeInstanceOf(Date);
    expect(b).toMatchObject({ status: "rejected" });
  });
});

describe("import conflicts", () => {
  const dupRow = [
    ["brand", "category_slug", "product_name", "is_demo"],
    ["Novik", "smartphones", "Aera 7 Pro Max", "true"],
  ];

  it("duplicate candidate → 'different product' creates it once; re-import is a no-op", async () => {
    const first = await runImport(dupRow);
    expect(first.preview.conflict).toBe(1);
    const item = await openItem("duplicate_candidate");
    await expect(
      approveReviewItem(ctx(), item.id, { choice: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow(/listed options/);
    await approveReviewItem(ctx(), item.id, { choice: "new" });
    const created = await db().select().from(products).where(eq(products.name, "Aera 7 Pro Max"));
    expect(created).toHaveLength(1);
    const again = await runImport(dupRow);
    expect(again.preview).toMatchObject({ create: 0, conflict: 0, skip: 1 });
    expect(
      await db().select().from(products).where(eq(products.name, "Aera 7 Pro Max")),
    ).toHaveLength(1);
  });

  it("duplicate candidate → 'same product' applies the row to that product", async () => {
    const rows = [
      ["brand", "category_slug", "product_name", "product_status", "is_demo"],
      ["Novik", "smartphones", "Aera 6 Pro Plus", "discontinued", "true"],
    ];
    await runImport(rows);
    const item = await openItem("duplicate_candidate");
    const target = (item.payload as { candidates: { id: string; name: string }[] }).candidates.find(
      (c) => c.name === "Aera 6 Pro",
    )!;
    await approveReviewItem(ctx(), item.id, { choice: target.id });
    const [p] = await db().select().from(products).where(eq(products.id, target.id));
    expect(p).toMatchObject({ name: "Aera 6 Pro Plus", productStatus: "discontinued" });
    expect((await runImport(rows)).preview).toMatchObject({ skip: 1, conflict: 0, create: 0 });
  });

  it("variant ambiguity → 'new variant' creates a separate regional variant", async () => {
    const all = parseCsv(await exportProductsCsv(db(), "smartphones"));
    const header = all[0]!;
    const col = (n: string) => header.indexOf(n);
    const row = all.find((r, i) => i > 0 && r[col("region_code")] === "EU")!;
    const us = [...row];
    us[col("region_code")] = "US";
    us[col("gtin")] = "";
    const variantsBefore = Number((await db().select({ n: count() }).from(productVariants))[0]!.n);
    expect((await runImport([header, us])).preview.conflict).toBe(1);
    const item = await openItem("variant_ambiguity");
    await approveReviewItem(ctx(), item.id, { choice: "new" });
    const variants = await db()
      .select()
      .from(productVariants)
      .where(sql`${productVariants.variantCode} = ${`${row[col("variant_code")]}-us`}`);
    expect(variants).toHaveLength(1);
    expect(variants[0]!.regionCode).toBe("US");
    expect((await runImport([header, us])).preview).toMatchObject({ conflict: 0, create: 0 });
    expect(Number((await db().select({ n: count() }).from(productVariants))[0]!.n)).toBe(
      variantsBefore + 1,
    );
  });
});

describe("public corrections", () => {
  const base = {
    key: "battery_capacity",
    value: "5000 mAh",
    sourceUrl: "https://maker.example/aera-7-pro",
    email: "reader@example.test",
  };

  it("validates, stores a correction item and drops the email when resolved", async () => {
    const pid = await productId("aera-7-pro");
    await expect(
      submitCorrection(db(), { ...base, productId: pid, sourceUrl: "not a url" }, "198.51.100.1"),
    ).rejects.toThrow(/highlighted/);
    await expect(
      submitCorrection(db(), { ...base, productId: pid, key: "no_such_key" }, "198.51.100.1"),
    ).rejects.toThrow(/Choose a specification/);
    expect(await submitCorrection(db(), { ...base, productId: pid }, "198.51.100.1")).toEqual({
      ok: true,
    });
    const item = await openItem("correction");
    expect(item.payload).toMatchObject({
      key: "battery_capacity",
      value: "5000 mAh",
      email: "reader@example.test",
    });
    expect(item.createdBy).toBeNull();

    // The current value is verified: approving needs an explicit "verified".
    await expect(approveReviewItem(ctx(), item.id)).rejects.toThrow(/verified/);
    await approveReviewItem(ctx(), item.id, { markVerified: true, note: "Matches the cited page" });
    const [resolved] = await db().select().from(reviewItems).where(eq(reviewItems.id, item.id));
    expect(resolved!.payload).not.toHaveProperty("email");
    const [spec] = await db().execute<{ value_numeric: string; source_name: string }>(sql`
      SELECT s.value_numeric::text, src.source_name FROM product_specifications s
      JOIN specification_definitions d ON d.id = s.specification_definition_id JOIN sources src ON src.id = s.source_id
      WHERE s.product_id = ${pid} AND d.key = 'battery_capacity' AND s.variant_id IS NULL`);
    expect(spec).toEqual({ value_numeric: "5000", source_name: "Reader corrections (reviewed)" });
  });

  it("ignores honeypot submissions and rate-limits per address", async () => {
    const pid = await productId("hush-4");
    const before = (await listReviewItems(db(), { type: "correction" })).items.length;
    expect(
      await submitCorrection(
        db(),
        { ...base, key: "", productId: pid, honeypot: "http://spam.example" },
        "198.51.100.9",
      ),
    ).toEqual({ ok: true });
    expect((await listReviewItems(db(), { type: "correction" })).items.length).toBe(before);
    for (let i = 0; i < CORRECTION_LIMIT; i++) {
      expect(
        await submitCorrection(db(), { ...base, key: "", productId: pid }, "198.51.100.10"),
      ).toEqual({ ok: true });
    }
    expect(
      await submitCorrection(db(), { ...base, key: "", productId: pid }, "198.51.100.10"),
    ).toEqual({ ok: false, reason: "rate_limited" });
    expect(
      await submitCorrection(db(), { ...base, key: "", productId: pid }, "198.51.100.11"),
    ).toEqual({ ok: true });
  });

  it("refuses unpublished products", async () => {
    const [draft] = await db()
      .select()
      .from(products)
      .where(ne(products.status, "published"))
      .limit(1);
    await expect(
      submitCorrection(db(), { ...base, key: "", productId: draft!.id }, "198.51.100.20"),
    ).rejects.toThrow(/cannot be corrected/);
  });
});
