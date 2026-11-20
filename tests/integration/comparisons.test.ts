import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brands, products, sources } from "@/db/schema";
import { seedDemoData } from "@/db/seed";
import { closeDb } from "@/lib/db";
import { compareProducts, listFeaturedComparisons } from "@/modules/comparisons/service";
import { archiveProduct, updateProduct } from "@/modules/products/service";
import { createSource } from "@/modules/sources/service";
import { setSpecificationValue } from "@/modules/specifications/service";
import { ctx, db, truncateAll } from "./helpers";

const ALL = { market: "ALL", staleHours: 72 };

beforeAll(async () => {
  await truncateAll();
  await seedDemoData(db());
});
afterAll(closeDb);

async function ok(slugs: string[], opts = ALL) {
  const r = await compareProducts(db(), slugs, opts);
  if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
  const rows = Object.fromEntries(r.groups.flatMap((g) => g.rows).map((row) => [row.key, row]));
  return { ...r, rows };
}

describe("compareProducts", () => {
  it("orders products canonically and normalises units across products", async () => {
    const r = await ok(["hush-5", "hush-4"]);
    expect(r.products.map((p) => p.slug)).toEqual(["hush-4", "hush-5"]);
    expect(r.category).toEqual({ slug: "headphones", name: "Headphones" });
    // Hush 5 was entered as "0.25 kg" and "4 cm"; Hush 4 as "268 g" and "40 mm".
    expect(r.rows.weight!.cells.map((c) => c.display)).toEqual(["268 g", "250 g"]);
    expect(r.rows.weight!.cells.map((c) => c.better)).toEqual([false, true]); // lower is better
    expect(r.rows.driver_size!).toMatchObject({ differs: false });
    expect(r.rows.battery_life!.cells.map((c) => c.better)).toEqual([false, true]);
  });

  it("shows Not available for missing values, distinct from No", async () => {
    const r = await ok(["aera-7-pro", "pocket-3", "strand-s"]);
    expect(r.rows.ram!.cells.map((c) => c.display)).toEqual(["12 GB", "8 GB", null]);
    expect(r.rows.wireless_charging!.cells.map((c) => c.display)).toEqual(["Yes", "No", null]);
    expect(r.rows.ram!.differs).toBe(true);
  });

  it("uses the deepest shared category: laptop rows for laptop + gaming laptop, GPU rows only for gaming laptops", async () => {
    const mixed = await ok(["vanta-14-2026", "strand-g16"]);
    expect(mixed.category.slug).toBe("laptops");
    expect(Object.keys(mixed.rows)).toContain("weight");
    expect(Object.keys(mixed.rows)).not.toContain("gpu_power");
  });

  it("refuses products from different top-level categories", async () => {
    const r = await compareProducts(db(), ["aera-7-pro", "vanta-14-2026"], ALL);
    expect(r.kind).toBe("mixed_categories");
    if (r.kind === "mixed_categories")
      expect(r.products.map((p) => p.topCategory.slug).sort()).toEqual(["laptops", "smartphones"]);
  });

  it("404s unknown or unpublished products and redirects renamed ones", async () => {
    expect(await compareProducts(db(), ["aera-7-pro", "nope"], ALL)).toEqual({ kind: "not_found" });
    const [p] = await db().select().from(products).where(eq(products.slug, "aera-6-pro"));
    await updateProduct(ctx(), p!.id, { slug: "aera-6-pro-2025" });
    expect(await compareProducts(db(), ["aera-7-pro", "aera-6-pro"], ALL)).toEqual({
      kind: "redirect",
      to: "/compare/aera-6-pro-2025-vs-aera-7-pro",
    });
    await updateProduct(ctx(), p!.id, { slug: "aera-6-pro" });
    const [arden] = await db().select().from(products).where(eq(products.slug, "arden"));
    await archiveProduct(ctx(), arden!.id);
    expect(await compareProducts(db(), ["arden", "hush-5"], ALL)).toEqual({ kind: "not_found" });
  });

  it("shows the best fresh offer per product for the selected market", async () => {
    const pl = await ok(["aera-7-pro", "pocket-3"], { market: "PL", staleHours: 72 });
    expect(pl.products.map((p) => p.offer?.price ?? null)).toEqual(["3349.0000", null]);
    const all = await ok(["aera-7-pro", "pocket-3"]);
    expect(all.products[0]!.offer).toMatchObject({ price: null, offerCount: 5, marketCount: 3 });
  });

  it("distinguishes manufacturer claims by source type", async () => {
    const maker = await createSource(ctx(), {
      sourceName: "Novik spec sheet (test)",
      sourceType: "manufacturer",
      usagePermitted: true,
    });
    const [p] = await db().select().from(products).where(eq(products.slug, "aera-7-pro"));
    // The stored value is verified, so only a human-verified change replaces it (rule 2.1.7).
    const res = await setSpecificationValue(ctx(), {
      productId: p!.id,
      key: "rear_camera_main",
      value: "64 MP",
      sourceId: maker.id,
      verificationStatus: "verified",
    });
    expect(res.outcome).toBe("updated");
    const r = await ok(["aera-7-pro", "aera-6-pro"]);
    expect(r.rows.rear_camera_main!.cells.map((c) => c.manufacturerClaim)).toEqual([false, true]);
    await db().delete(sources).where(eq(sources.id, maker.id));
  });
});

describe("featured comparisons", () => {
  it("lists curated comparisons with canonical paths, optionally by brand", async () => {
    const all = await listFeaturedComparisons(db());
    expect(all.map((f) => f.path)).toEqual([
      "/compare/aera-6-pro-vs-aera-7-pro",
      "/compare/ridge-6800-vs-ridge-7800-vs-tessel-12",
    ]);
    const [halden] = await db().select().from(brands).where(eq(brands.slug, "halden"));
    const byHalden = await listFeaturedComparisons(db(), { brandId: halden!.id });
    expect(byHalden.map((f) => f.title)).toEqual(["Ridge 7800 vs Ridge 6800 vs Tessel 12"]);
  });

  it("hides a featured comparison when one of its products is not published", async () => {
    const [p] = await db().select().from(products).where(eq(products.slug, "tessel-12"));
    await archiveProduct(ctx(), p!.id);
    expect((await listFeaturedComparisons(db())).map((f) => f.title)).toEqual([
      "Aera 7 Pro vs Aera 6 Pro",
    ]);
  });
});
