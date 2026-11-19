import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { products, productVariants } from "@/db/schema";
import { closeDb } from "@/lib/db";
import { ConflictError, InvalidStateError, ValidationError } from "@/modules/_shared/errors";
import {
  archiveProduct,
  createProduct,
  deleteDraftProduct,
  getPublishedProductBySlug,
  listProducts,
  publishProduct,
  updateProduct,
  verifyProduct,
} from "@/modules/products/service";
import { resolveSlugRedirect } from "@/modules/slugs/service";
import {
  createProductVariant,
  listVariants,
  setDefaultVariant,
  updateProductVariant,
} from "@/modules/variants/service";
import { ctx, db, makeBrand, makeCategory, makeProduct, truncateAll } from "./helpers";

beforeEach(truncateAll);
afterAll(closeDb);

describe("products", () => {
  it("creates drafts only, and only published products are public", async () => {
    const p = await makeProduct({ name: "Aera 7 Pro" });
    expect(p).toMatchObject({
      slug: "aera-7-pro",
      publicationStatus: "draft",
      verificationStatus: "draft",
      isDemo: false,
    });
    expect(await getPublishedProductBySlug(db(), "aera-7-pro")).toBeNull();
    await publishProduct(ctx(), p.id);
    expect((await getPublishedProductBySlug(db(), "aera-7-pro"))?.product.id).toBe(p.id);
    await archiveProduct(ctx(), p.id);
    expect(await getPublishedProductBySlug(db(), "aera-7-pro")).toBeNull();
  });

  it("reserves -vs- in product slugs at both the Zod and the database level", async () => {
    await expect(makeProduct({ name: "Alpha vs Beta" })).rejects.toThrow(/-vs-/);
    const p = await makeProduct();
    await expect(
      db().update(products).set({ slug: "a-vs-b" }).where(eq(products.id, p.id)),
    ).rejects.toThrow();
  });

  it("enforces globally unique slugs and per-brand case-insensitive model numbers", async () => {
    const brand = await makeBrand();
    const other = await makeBrand();
    const category = await makeCategory();
    await makeProduct({
      brandId: brand.id,
      categoryId: category.id,
      name: "One",
      modelNumber: "NA7P-2611",
    });
    await expect(
      makeProduct({
        brandId: brand.id,
        categoryId: category.id,
        name: "Two",
        modelNumber: "na7p-2611",
      }),
    ).rejects.toThrow(/model number/);
    // Same model number at another brand is allowed.
    await makeProduct({
      brandId: other.id,
      categoryId: category.id,
      name: "Three",
      modelNumber: "NA7P-2611",
    });
    await expect(
      makeProduct({ brandId: other.id, categoryId: category.id, name: "One", modelNumber: null }),
    ).rejects.toThrow(ConflictError);
  });

  it("validates date ordering on create and on partial update", async () => {
    const brand = await makeBrand();
    const category = await makeCategory();
    await expect(
      createProduct(ctx(), {
        brandId: brand.id,
        categoryId: category.id,
        name: "X",
        releaseDate: "2026-01-01",
        announcedDate: "2026-02-01",
      }),
    ).rejects.toThrow(ValidationError);
    const p = await createProduct(ctx(), {
      brandId: brand.id,
      categoryId: category.id,
      name: "Y",
      releaseDate: "2026-03-01",
    });
    await expect(updateProduct(ctx(), p.id, { discontinuedDate: "2025-01-01" })).rejects.toThrow(
      /Discontinued/,
    );
    await expect(updateProduct(ctx(), p.id, { releaseDate: "2026-02-30" })).rejects.toThrow(
      /real date/,
    );
  });

  it("partial updates do not reset other fields, and slug changes redirect", async () => {
    const p = await makeProduct({ name: "Vanta 14" });
    await updateProduct(ctx(), p.id, { isFeatured: true, aliases: ["V14"] });
    const updated = await updateProduct(ctx(), p.id, { shortDescription: "Light." });
    expect(updated).toMatchObject({
      isFeatured: true,
      aliases: ["V14"],
      shortDescription: "Light.",
      productStatus: "unknown",
    });
    await updateProduct(ctx(), p.id, { slug: "vanta-14-2026" });
    expect(await resolveSlugRedirect(db(), "product", "vanta-14")).toBe("vanta-14-2026");
  });

  it("enforces publication state transitions", async () => {
    const p = await makeProduct();
    await publishProduct(ctx(), p.id);
    await expect(publishProduct(ctx(), p.id)).rejects.toThrow(InvalidStateError);
    await expect(deleteDraftProduct(ctx(), p.id, { confirm: true })).rejects.toThrow(/archive/);
    const rejected = await makeProduct();
    await verifyProduct(ctx(), rejected.id, "rejected");
    await expect(publishProduct(ctx(), rejected.id)).rejects.toThrow(/Rejected/);
  });

  it("hard-deletes drafts only with confirmation", async () => {
    const p = await makeProduct();
    await expect(deleteDraftProduct(ctx(), p.id, { confirm: false })).rejects.toThrow(
      /confirmation/,
    );
    await deleteDraftProduct(ctx(), p.id, { confirm: true });
    expect(await db().select().from(products).where(eq(products.id, p.id))).toHaveLength(0);
  });

  it("stamps last_verified_at only for verified states", async () => {
    const p = await makeProduct();
    expect((await verifyProduct(ctx(), p.id, "verified")).lastVerifiedAt).toBeInstanceOf(Date);
    expect((await verifyProduct(ctx(), p.id, "needs_review")).lastVerifiedAt).toBeNull();
  });

  it("paginates and clamps page size to 48", async () => {
    const brand = await makeBrand();
    const category = await makeCategory();
    for (let i = 0; i < 5; i++) {
      const p = await makeProduct({ brandId: brand.id, categoryId: category.id, name: `P${i}` });
      await publishProduct(ctx(), p.id);
    }
    await makeProduct({ brandId: brand.id, categoryId: category.id, name: "Draft" });
    const page = await listProducts(db(), {
      pageSize: 2,
      page: 2,
      sort: "name",
      categoryId: category.id,
    });
    expect(page).toMatchObject({ total: 5, page: 2, pageSize: 2, pageCount: 3 });
    expect(page.items.map((p) => p.name)).toEqual(["P2", "P3"]);
    expect((await listProducts(db(), { pageSize: 10_000 })).pageSize).toBe(48);
  });

  it("finds products through the full-text search vector, including the brand name", async () => {
    const brand = await makeBrand("Corvála");
    const p = await makeProduct({
      brandId: brand.id,
      name: "Ridge 7800",
      modelNumber: "CG-7800-16",
    });
    const [row] = await db()
      .select({ v: products.searchVector })
      .from(products)
      .where(eq(products.id, p.id));
    expect(row!.v).toContain("'corvala'"); // unaccented brand
    expect(row!.v).toContain("'ridge'");
  });
});

describe("variants", () => {
  it("makes the first variant the default and keeps exactly one default", async () => {
    const p = await makeProduct();
    const a = await createProductVariant(ctx(), p.id, {
      variantName: "256 GB · EU",
      regionCode: "EU",
    });
    expect(a).toMatchObject({ isDefault: true, variantCode: "256-gb-eu" });
    const b = await createProductVariant(ctx(), p.id, {
      variantName: "512 GB · EU",
      isDefault: true,
    });
    await setDefaultVariant(ctx(), a.id);
    const list = await listVariants(db(), p.id);
    expect(list.filter((v) => v.isDefault).map((v) => v.id)).toEqual([a.id]);
    await expect(updateProductVariant(ctx(), a.id, { isDefault: false })).rejects.toThrow(
      /another default/,
    );
    // DB-level guarantee too.
    await expect(
      db().update(productVariants).set({ isDefault: true }).where(eq(productVariants.id, b.id)),
    ).rejects.toThrow();
  });

  it("validates GTIN check digits and keeps GTINs unique", async () => {
    const p = await makeProduct();
    await expect(
      createProductVariant(ctx(), p.id, { variantName: "Bad", barcodeGtin: "4006381333932" }),
    ).rejects.toThrow(/GTIN/);
    await createProductVariant(ctx(), p.id, { variantName: "Good", barcodeGtin: "4006381333931" });
    const q = await makeProduct();
    await expect(
      createProductVariant(ctx(), q.id, { variantName: "Dup", barcodeGtin: "4006381333931" }),
    ).rejects.toThrow(/GTIN/);
  });

  it("never merges regional variants: distinct codes per product", async () => {
    const p = await makeProduct();
    await createProductVariant(ctx(), p.id, {
      variantName: "EU",
      variantCode: "eu",
      regionCode: "EU",
    });
    await createProductVariant(ctx(), p.id, {
      variantName: "US",
      variantCode: "us",
      regionCode: "US",
    });
    await expect(
      createProductVariant(ctx(), p.id, { variantName: "EU again", variantCode: "eu" }),
    ).rejects.toThrow(ConflictError);
    expect(await listVariants(db(), p.id)).toHaveLength(2);
  });
});
