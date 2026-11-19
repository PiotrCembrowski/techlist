import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { productSpecifications, reviewItems } from "@/db/schema";
import { closeDb } from "@/lib/db";
import { ConflictError, ValidationError } from "@/modules/_shared/errors";
import {
  createSpecificationDefinition,
  createSpecificationGroup,
  getEffectiveDefinitions,
  getProductSpecifications,
  getSpecificationsForProducts,
  setSpecificationValue,
} from "@/modules/specifications/service";
import { createProductVariant } from "@/modules/variants/service";
import { ctx, db, makeCategory, makeProduct, makeSpecCategory, truncateAll } from "./helpers";

beforeEach(truncateAll);
afterAll(closeDb);

describe("specification definitions", () => {
  it("are inherited from ancestor categories", async () => {
    const { category: laptops } = await makeSpecCategory();
    const gaming = await makeCategory("Gaming", laptops.id);
    const g = await createSpecificationGroup(ctx(), {
      categoryId: gaming.id,
      key: "graphics",
      name: "Graphics",
    });
    await createSpecificationDefinition(ctx(), {
      categoryId: gaming.id,
      groupId: g.id,
      key: "gpu_power",
      name: "GPU power",
      dataType: "integer",
      canonicalUnit: "W",
    });
    const defs = await getEffectiveDefinitions(db(), gaming.id);
    expect(defs.map((d) => d.key)).toEqual(
      expect.arrayContaining(["storage", "weight", "gpu_power"]),
    );
    expect(defs.find((d) => d.key === "storage")?.inheritedDepth).toBe(1);
    expect(defs.find((d) => d.key === "gpu_power")?.inheritedDepth).toBe(0);
    // The parent does not see the child's definitions.
    expect((await getEffectiveDefinitions(db(), laptops.id)).map((d) => d.key)).not.toContain(
      "gpu_power",
    );
  });

  it("keeps keys unique across the whole inheritance chain", async () => {
    const { category: laptops } = await makeSpecCategory();
    const gaming = await makeCategory("Gaming", laptops.id);
    await expect(
      createSpecificationDefinition(ctx(), {
        categoryId: gaming.id,
        key: "storage",
        name: "Storage",
        dataType: "integer",
        canonicalUnit: "GB",
      }),
    ).rejects.toThrow(ConflictError);
    await createSpecificationDefinition(ctx(), {
      categoryId: gaming.id,
      key: "rgb",
      name: "RGB",
      dataType: "boolean",
    });
    await expect(
      createSpecificationDefinition(ctx(), {
        categoryId: laptops.id,
        key: "rgb",
        name: "RGB",
        dataType: "boolean",
      }),
    ).rejects.toThrow(/inheritance chain/);
  });

  it("rejects inconsistent definitions and foreign groups", async () => {
    const { category } = await makeSpecCategory();
    await expect(
      createSpecificationDefinition(ctx(), {
        categoryId: category.id,
        key: "x",
        name: "X",
        dataType: "text",
        canonicalUnit: "GB",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createSpecificationDefinition(ctx(), {
        categoryId: category.id,
        key: "Bad Key",
        name: "X",
        dataType: "text",
      }),
    ).rejects.toThrow(ValidationError);
    const { group: foreign } = await makeSpecCategory();
    await expect(
      createSpecificationDefinition(ctx(), {
        categoryId: category.id,
        groupId: foreign.id,
        key: "y",
        name: "Y",
        dataType: "text",
      }),
    ).rejects.toThrow(/group must belong/);
  });
});

describe("specification values", () => {
  async function setup() {
    const sc = await makeSpecCategory();
    const product = await makeProduct({ categoryId: sc.category.id });
    return { ...sc, product };
  }

  it("parses into the canonical unit and stores exactly one typed column", async () => {
    const { product } = await setup();
    const r = await setSpecificationValue(ctx(), {
      productId: product.id,
      key: "storage",
      value: "1 TB",
    });
    expect(r.outcome).toBe("created");
    expect(r.specification).toMatchObject({
      valueNumeric: 1000,
      valueText: null,
      verificationStatus: "unverified",
      origin: "manual",
    });
    await setSpecificationValue(ctx(), { productId: product.id, key: "weight", value: "1390 g" });
    await setSpecificationValue(ctx(), {
      productId: product.id,
      key: "ports",
      value: "hdmi, USB-C",
    });
    await setSpecificationValue(ctx(), { productId: product.id, key: "backlit", value: "no" });
    const all = await getProductSpecifications(db(), product.id);
    const byKey = Object.fromEntries(all.map((s) => [s.definition.key, s.value]));
    expect(byKey.weight?.valueNumeric).toBe(1.39);
    expect(byKey.ports?.valueJson).toEqual(["USB-C", "HDMI"]);
    expect(byKey.backlit?.valueBoolean).toBe(false);
  });

  it("rejects incompatible units, rule violations and keys from other categories", async () => {
    const { product } = await setup();
    await expect(
      setSpecificationValue(ctx(), { productId: product.id, key: "storage", value: "3 kg" }),
    ).rejects.toThrow(/Incompatible/);
    await expect(
      setSpecificationValue(ctx(), { productId: product.id, key: "storage", value: "20 TB" }),
    ).rejects.toThrow(/at most/);
    await expect(
      setSpecificationValue(ctx(), { productId: product.id, key: "note", value: "far too long" }),
    ).rejects.toThrow(/at most 10/);
    await expect(
      setSpecificationValue(ctx(), { productId: product.id, key: "gpu_power", value: "100 W" }),
    ).rejects.toThrow(/not a specification of this product/);
  });

  it("is idempotent for an equal value", async () => {
    const { product } = await setup();
    await setSpecificationValue(ctx(), { productId: product.id, key: "storage", value: "1 TB" });
    const again = await setSpecificationValue(ctx(), {
      productId: product.id,
      key: "storage",
      value: "1000 GB",
    });
    expect(again.outcome).toBe("unchanged");
  });

  it("never overwrites a verified value with unverified data — it creates a review item", async () => {
    const { product } = await setup();
    await setSpecificationValue(ctx(), {
      productId: product.id,
      key: "storage",
      value: "512 GB",
      verificationStatus: "verified",
    });
    const r = await setSpecificationValue(ctx(), {
      productId: product.id,
      key: "storage",
      value: "1 TB",
      origin: "import",
    });
    expect(r.outcome).toBe("review_required");
    expect(r.specification).toMatchObject({ valueNumeric: 512, verificationStatus: "verified" });
    const items = await db()
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.itemType, "conflicting_value"));
    expect(items).toHaveLength(1);
    expect(items[0]!.payload).toMatchObject({
      key: "storage",
      proposed: { valueNumeric: 1000 },
      current: { valueNumeric: 512 },
    });
    // A human-verified change is allowed.
    const ok = await setSpecificationValue(ctx(), {
      productId: product.id,
      key: "storage",
      value: "1 TB",
      verificationStatus: "verified",
    });
    expect(ok.outcome).toBe("updated");
  });

  it("forces AI-extracted values to unverified and queues them for review", async () => {
    const { product } = await setup();
    const r = await setSpecificationValue(ctx(), {
      productId: product.id,
      key: "screen_size",
      value: '14.2"',
      origin: "ai_extracted",
      confidence: 0.82,
      verificationStatus: "verified",
    });
    expect(r.specification).toMatchObject({
      verificationStatus: "unverified",
      origin: "ai_extracted",
      confidence: 0.82,
      lastVerifiedAt: null,
    });
    const items = await db()
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.itemType, "unverified_spec"));
    expect(items).toHaveLength(1);
  });

  it("applies variant-level overrides", async () => {
    const { product } = await setup();
    const v = await createProductVariant(ctx(), product.id, { variantName: "1 TB" });
    await setSpecificationValue(ctx(), { productId: product.id, key: "storage", value: "512 GB" });
    await setSpecificationValue(ctx(), {
      productId: product.id,
      variantId: v.id,
      key: "storage",
      value: "1 TB",
    });
    const base = await getProductSpecifications(db(), product.id);
    const variant = await getProductSpecifications(db(), product.id, v.id);
    expect(base.find((s) => s.definition.key === "storage")?.value.valueNumeric).toBe(512);
    expect(variant.find((s) => s.definition.key === "storage")).toMatchObject({
      isVariantOverride: true,
      value: { valueNumeric: 1000 },
    });
    const other = await makeProduct({ categoryId: product.categoryId });
    await expect(
      setSpecificationValue(ctx(), {
        productId: other.id,
        variantId: v.id,
        key: "storage",
        value: "1 TB",
      }),
    ).rejects.toThrow(/does not belong/);
  });

  it("database: UNIQUE NULLS NOT DISTINCT and exactly-one-value CHECK", async () => {
    const { product, defs } = await setup();
    const base = {
      productId: product.id,
      variantId: null,
      specificationDefinitionId: defs.storage.id,
    };
    await db()
      .insert(productSpecifications)
      .values({ ...base, valueNumeric: 1 });
    // Same product + NULL variant + definition: rejected even though variant_id is NULL.
    await expect(
      db()
        .insert(productSpecifications)
        .values({ ...base, valueNumeric: 2 }),
    ).rejects.toThrow();
    await db()
      .delete(productSpecifications)
      .where(and(eq(productSpecifications.productId, product.id)));
    await expect(
      db()
        .insert(productSpecifications)
        .values({ ...base }),
    ).rejects.toThrow();
    await expect(
      db()
        .insert(productSpecifications)
        .values({ ...base, valueNumeric: 1, valueText: "1" }),
    ).rejects.toThrow();
    await expect(
      db()
        .insert(productSpecifications)
        .values({ ...base, valueNumeric: 1, verificationStatus: "verified" }),
    ).rejects.toThrow();
  });

  it("loads values for a page of products in one query", async () => {
    const { product, category, defs } = await setup();
    const second = await makeProduct({ categoryId: category.id });
    await setSpecificationValue(ctx(), { productId: product.id, key: "storage", value: "1 TB" });
    await setSpecificationValue(ctx(), { productId: second.id, key: "storage", value: "256 GB" });
    await setSpecificationValue(ctx(), { productId: second.id, key: "weight", value: "1 kg" });
    const map = await getSpecificationsForProducts(
      db(),
      [product.id, second.id],
      [defs.storage.id],
    );
    expect(map.get(product.id)?.map((s) => s.valueNumeric)).toEqual([1000]);
    expect(map.get(second.id)?.map((s) => s.valueNumeric)).toEqual([256]);
  });
});
