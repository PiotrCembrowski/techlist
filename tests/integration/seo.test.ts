// Indexing is off site-wide while demo data is enabled; these tests need it on.
process.env.ENABLE_DEMO_DATA = "false";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { products } from "@/db/schema";
import { seedDemoData } from "@/db/seed";
import { closeDb } from "@/lib/db";
import { createBrand } from "@/modules/brands/service";
import { createCategory } from "@/modules/categories/service";
import { createProduct, publishProduct, verifyProduct } from "@/modules/products/service";
import { loadProductPage } from "@/modules/products/public";
import { countIndexableProducts, indexableProductIds } from "@/modules/seo/queries";
import { sitemapCount, sitemapEntries } from "@/modules/seo/sitemap";
import {
  createSpecificationDefinition,
  setSpecificationValue,
} from "@/modules/specifications/service";
import { createProductVariant } from "@/modules/variants/service";
import { ctx, db, truncateAll } from "./helpers";

type Setup = {
  publish?: boolean;
  verify?: "verified" | "partially_verified" | "needs_review" | null;
  demo?: boolean;
  values?: number;
  variantOnly?: boolean;
};

let parentSlug: string;
let childSlug: string;
let brandSlug: string;
const made: Record<string, string> = {};

beforeAll(async () => {
  await truncateAll();
  await seedDemoData(db()); // all demo: never indexable
  const parent = await createCategory(ctx(), { name: "Seo Devices" });
  const child = await createCategory(ctx(), { name: "Seo Tablets", parentId: parent.id });
  parentSlug = parent.slug;
  childSlug = child.slug;
  // Five required specifications: three on the parent (inherited), two on the child.
  for (const [i, cat] of [parent, parent, parent, child, child].entries()) {
    await createSpecificationDefinition(ctx(), {
      categoryId: cat.id,
      key: `core_${i}`,
      name: `Core ${i}`,
      dataType: "text",
      isRequired: true,
    });
  }
  const brand = await createBrand(ctx(), { name: "Seoquill" });
  brandSlug = brand.slug;

  const make = async (name: string, s: Setup) => {
    const p = await createProduct(ctx(), {
      brandId: brand.id,
      categoryId: child.id,
      name,
      isDemo: s.demo ?? false,
    });
    let variantId: string | null = null;
    if (s.variantOnly)
      variantId = (await createProductVariant(ctx(), p.id, { variantName: "Only" })).id;
    for (let i = 0; i < (s.values ?? 0); i++) {
      await setSpecificationValue(ctx(), {
        productId: p.id,
        variantId,
        key: `core_${i}`,
        value: `v${i}`,
      });
    }
    if (s.verify) await verifyProduct(ctx(), p.id, s.verify);
    if (s.publish !== false) await publishProduct(ctx(), p.id);
    made[name] = p.id;
  };
  await make("Exactly sixty", { verify: "verified", values: 3 }); // 3/5 = 60 % → indexable
  await make("Complete partial", { verify: "partially_verified", values: 5 }); // indexable
  await make("Too thin", { verify: "verified", values: 2 }); // 40 %
  await make("Unverified", { verify: "needs_review", values: 5 });
  await make("Demo copy", { verify: "verified", values: 5, demo: true });
  await make("Draft only", { verify: "verified", values: 5, publish: false });
  await make("Variant values", { verify: "verified", values: 5, variantOnly: true }); // not product-level
});
afterAll(closeDb);

describe("indexable_products view", () => {
  it("matches getIndexability for every product", async () => {
    const all = await db()
      .select({ id: products.id, slug: products.slug, status: products.publicationStatus })
      .from(products);
    const view = await indexableProductIds(
      db(),
      all.map((p) => p.id),
    );
    for (const p of all) {
      let expected = false;
      if (p.status === "published") {
        const [b] = await db().execute<{ slug: string }>(
          sql`SELECT b.slug FROM brands b JOIN products p ON p.brand_id = b.id WHERE p.id = ${p.id}`,
        );
        const page = await loadProductPage(db(), b!.slug, p.slug);
        expected = page.kind === "ok" && page.data.indexability.index;
      }
      expect(view.has(p.id), p.slug).toBe(expected);
    }
    expect([...view].sort()).toEqual([made["Exactly sixty"]!, made["Complete partial"]!].sort());
  });

  it("counts by category subtree and brand", async () => {
    const [parent] = await db().execute<{ id: string }>(
      sql`SELECT id FROM categories WHERE slug = ${parentSlug}`,
    );
    const [child] = await db().execute<{ id: string }>(
      sql`SELECT id FROM categories WHERE slug = ${childSlug}`,
    );
    expect(await countIndexableProducts(db(), { categoryIds: [child!.id] })).toBe(2);
    expect(await countIndexableProducts(db(), { categoryIds: [parent!.id] })).toBe(0); // its own products only
    expect(await countIndexableProducts(db(), {})).toBe(2);
  });

  it("drops a product when its brand is deactivated", async () => {
    await db().execute(sql`UPDATE brands SET is_active = false WHERE slug = ${brandSlug}`);
    expect(await countIndexableProducts(db(), {})).toBe(0);
    await db().execute(sql`UPDATE brands SET is_active = true WHERE slug = ${brandSlug}`);
  });
});

describe("sitemap", () => {
  it("lists only indexable records, never demo data", async () => {
    const paths = (await sitemapEntries(db(), 0)).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/",
        "/products",
        "/brands",
        `/categories/${parentSlug}`, // has an indexable product in its subtree
        `/categories/${childSlug}`,
        `/brands/${brandSlug}`,
        `/products/${brandSlug}/exactly-sixty`,
        `/products/${brandSlug}/complete-partial`,
      ]),
    );
    for (const bad of ["too-thin", "unverified", "demo-copy", "draft-only", "variant-values"]) {
      expect(paths).not.toContain(`/products/${brandSlug}/${bad}`);
    }
    // Seeded demo records and demo-only listings are absent.
    expect(paths.some((p) => p.startsWith("/products/novik"))).toBe(false);
    expect(paths).not.toContain("/brands/novik");
    expect(paths).not.toContain("/guides");
    expect(paths.some((p) => p.startsWith("/compare/"))).toBe(false);
    expect(paths).not.toContain("/categories/laptops");
  });

  it("splits into files of at most `limit` URLs without gaps or duplicates", async () => {
    const all = (await sitemapEntries(db(), 0)).map((e) => e.path);
    const limit = 3;
    const n = await sitemapCount(db(), limit);
    expect(n).toBe(Math.ceil(all.length / limit));
    const chunks = [];
    for (let i = 0; i < n; i++)
      chunks.push((await sitemapEntries(db(), i, limit)).map((e) => e.path));
    expect(chunks.every((c) => c.length <= limit)).toBe(true);
    expect(chunks.flat()).toEqual(all);
    expect(await sitemapEntries(db(), n, limit)).toEqual([]);
  });

  it("is empty while demo data is enabled", async () => {
    // getEnv() is cached per test file: check through a fresh module instance.
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.ENABLE_DEMO_DATA = "true";
    const fresh = await import("@/modules/seo/sitemap");
    expect(await fresh.sitemapEntries(db(), 0)).toEqual([]);
    process.env.ENABLE_DEMO_DATA = "false";
  });
});

describe("product page indexability", () => {
  it("is exposed on the page data", async () => {
    const [p] = await db().select().from(products).where(eq(products.id, made["Too thin"]!));
    const page = await loadProductPage(db(), brandSlug, p!.slug);
    expect(page.kind === "ok" && page.data.indexability).toEqual({
      index: false,
      follow: true,
      reason: "too few core specifications",
    });
  });
});
