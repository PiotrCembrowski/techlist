/**
 * TEST FIXTURES ONLY: synthetic provider records (fictional brand "Novik"; GTINs from the GS1
 * restricted-circulation prefix 2). They are not, and do not imitate, real provider output.
 */
import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  categories,
  fieldProvenance,
  productIdentifiers,
  productImages,
  products,
  productSourceRecords,
  productSpecifications,
  productVariants,
  reviewItems,
  sources,
  specificationDefinitions,
} from "@/db/schema";
import { closeDb } from "@/lib/db";
import { gtinCheckDigit } from "@/lib/validation";
import { createBrand } from "@/modules/brands/service";
import { importNormalizedProduct, type ImportSource } from "@/modules/import-core/apply";
import { bootstrapCatalog } from "@/modules/import-core/bootstrap";
import { featureNameKey, loadNormalizeContext, mapCategory } from "@/modules/import-core/mappings";
import { normalizeRecord } from "@/modules/import-core/normalize";
import { unmappedFeatureReport } from "@/modules/import-core/reports";
import { getProductById, publishProduct, updateProduct } from "@/modules/products/service";
import type { ProviderFeature, ProviderRecord } from "@/modules/providers/core/types";
import { approveReviewItem } from "@/modules/review-queue/service";
import { setSpecificationValue } from "@/modules/specifications/service";
import { ctx, db, truncateAll } from "./helpers";

const gtin = (body12: string) => `${body12}${gtinCheckDigit(body12)}`;
const G1 = gtin("200000000101");
const G2 = gtin("200000000102");
const G3 = gtin("200000000103");

const LICENCE = {
  name: "Fixture licence",
  url: null,
  usage: "store" as const,
  attributionRequired: true,
  attribution: "Fixture data",
  imageLicence: "provider" as const,
  unverified: true,
};

let source: ImportSource;
let otherSource: ImportSource;
let phones: { id: string; slug: string };

const f = (externalId: string, value: string, unit: string | null = null): ProviderFeature => ({
  externalId,
  name: externalId,
  value,
  unit,
});

function record(over: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    provider: "icecat",
    providerProductId: "FX-100",
    url: "https://example.test/fx-100",
    brand: "Novik",
    name: "Novik Aera 9",
    modelNumber: "NK-A9",
    mpn: "NKA9-256-BK",
    gtins: [G1],
    categoryExternalId: "fx-phones",
    categoryName: "Phones",
    releaseDate: "2026-09-01",
    description: "Fixture description.",
    features: [
      f("FX-storage", "256", "GB"),
      f("FX-ram", "8", "GB"),
      f("FX-battery", "5000", "mAh"),
      f("FX-unmapped", "yes"),
    ],
    images: [
      {
        url: "https://img.example.test/fx-100.jpg",
        width: 800,
        height: 800,
        author: null,
        licence: "Fixture image licence",
        licenceUrl: null,
      },
    ],
    quality: "FIXTURE",
    retrievedAt: new Date("2026-11-25T10:00:00Z"),
    payloadHash: "1".repeat(64),
    variant: { colour: "Black" },
    ...over,
  };
}

async function run(
  r: ProviderRecord,
  opts: {
    src?: ImportSource;
    confidence?: number;
    decision?: Parameters<typeof importNormalizedProduct>[1]["decision"];
  } = {},
) {
  const category = await mapCategory(db(), r.provider, r.categoryExternalId);
  const nctx = await loadNormalizeContext(db(), r.provider, category, opts.confidence ?? 0.8);
  return importNormalizedProduct(ctx(), {
    product: normalizeRecord(r, nctx),
    source: opts.src ?? source,
    category,
    raw: r,
    decision: opts.decision,
  });
}

const tableCount = async (t: typeof products | typeof productVariants | typeof reviewItems) =>
  Number((await db().select({ n: count() }).from(t))[0]!.n);

beforeEach(async () => {
  await truncateAll();
  await bootstrapCatalog(ctx());
  const [cat] = await db().select().from(categories).where(eq(categories.slug, "smartphones"));
  phones = { id: cat!.id, slug: cat!.slug };
  await createBrand(ctx(), { name: "Novik" });
  const [s1] = await db()
    .insert(sources)
    .values({
      sourceName: "Fixture provider",
      sourceType: "licensed_provider",
      providerKey: "icecat",
      usagePermitted: true,
    })
    .returning();
  const [s2] = await db()
    .insert(sources)
    .values({
      sourceName: "Second fixture provider",
      sourceType: "licensed_provider",
      providerKey: "wikidata",
      usagePermitted: true,
    })
    .returning();
  source = { id: s1!.id, provider: "icecat", licence: LICENCE };
  otherSource = { id: s2!.id, provider: "wikidata", licence: { ...LICENCE, imageLicence: "none" } };
  const defs = await db()
    .select()
    .from(specificationDefinitions)
    .where(eq(specificationDefinitions.categoryId, phones.id));
  const defId = (key: string) => defs.find((d) => d.key === key)!.id;
  await db().execute(sql`
    INSERT INTO provider_mappings (provider, mapping_type, external_id, target_category_id)
    VALUES ('icecat', 'category', 'fx-phones', ${phones.id}), ('wikidata', 'category', 'fx-phones', ${phones.id})`);
  for (const provider of ["icecat", "wikidata"])
    for (const [ext, key] of [
      ["FX-storage", "storage"],
      ["FX-ram", "ram"],
      ["FX-battery", "battery_capacity"],
      [featureNameKey("Operating system"), "operating_system"],
    ] as const)
      await db().execute(sql`
        INSERT INTO provider_mappings (provider, mapping_type, external_id, target_definition_id)
        VALUES (${provider}, 'feature', ${ext}, ${defId(key)})`);
});
afterAll(closeDb);

describe("catalogue bootstrap", () => {
  it("creates the six categories once, reports conflicts, and changes nothing on re-run", async () => {
    const slugs = (await db().select({ slug: categories.slug }).from(categories))
      .map((c) => c.slug)
      .sort();
    expect(slugs).toEqual(["cpus", "gpus", "headphones", "laptops", "monitors", "smartphones"]);
    const again = await bootstrapCatalog(ctx());
    expect(again.every((r) => !r.categoryCreated && r.definitionsCreated.length === 0)).toBe(true);

    await db()
      .update(specificationDefinitions)
      .set({ dataType: "enum", validationRules: { options: ["A", "B"] } })
      .where(
        and(
          eq(specificationDefinitions.categoryId, phones.id),
          eq(specificationDefinitions.key, "operating_system"),
        ),
      );
    const report = await bootstrapCatalog(ctx(), { dryRun: true });
    expect(report.find((r) => r.slug === "smartphones")!.conflicts).toEqual([
      { key: "operating_system", reason: "type is enum, configuration says text" },
    ]);
  });

  it("dry run writes nothing", async () => {
    await truncateAll();
    const report = await bootstrapCatalog(ctx(), { dryRun: true });
    expect(report).toHaveLength(6);
    expect(await db().select().from(categories)).toHaveLength(0);
  });
});

describe("importing a new product", () => {
  it("creates needs_review records with identifiers, specs, provenance, images and a source record", async () => {
    const out = await run(record());
    expect(out.status).toBe("created");
    const p = (await getProductById(db(), out.productId!))!;
    expect(p).toMatchObject({
      name: "Aera 9",
      status: "needs_review",
      modelNumber: "NK-A9",
      releaseDate: "2026-09-01",
    });
    const [v] = await db()
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, p.id));
    expect(v).toMatchObject({
      status: "needs_review",
      storageConfiguration: "256 GB",
      memoryConfiguration: "8 GB",
      color: "Black",
      barcodeGtin: G1,
    });

    const ids = await db()
      .select()
      .from(productIdentifiers)
      .where(eq(productIdentifiers.productId, p.id));
    expect(ids.map((i) => [i.identifierType, i.value]).sort()).toEqual(
      [
        ["gtin", `0${G1}`],
        ["model_number", "NKA9"],
        ["mpn", "NKA9-256-BK"],
        ["provider_product_id", "FX-100"],
      ].sort(),
    );
    const specs = await db()
      .select()
      .from(productSpecifications)
      .where(eq(productSpecifications.productId, p.id));
    expect(specs).toHaveLength(3);
    expect(
      specs.every(
        (s) =>
          s.origin === "import" &&
          s.verificationStatus === "unverified" &&
          s.sourceId === source.id,
      ),
    ).toBe(true);
    expect(specs.find((s) => s.rawValue === "256")).toMatchObject({
      rawUnit: "GB",
      valueNumeric: 256,
    });

    const prov = await db()
      .select()
      .from(fieldProvenance)
      .where(eq(fieldProvenance.productId, p.id));
    expect(prov.filter((r) => r.isCurrent).map((r) => r.field)).toEqual(
      expect.arrayContaining([
        "name",
        "model_number",
        "release_date",
        "spec:storage",
        "storage",
        "gtin",
      ]),
    );
    const [img] = await db().select().from(productImages).where(eq(productImages.productId, p.id));
    expect(img).toMatchObject({
      rightsStatus: "needs_review",
      remoteUrl: "https://img.example.test/fx-100.jpg",
      storageKey: null,
    });

    const [rec] = await db()
      .select()
      .from(productSourceRecords)
      .where(eq(productSourceRecords.productId, p.id));
    expect(rec).toMatchObject({
      providerProductId: "FX-100",
      payloadHash: "1".repeat(64),
      attributionText: "Fixture data",
    });
    expect(rec!.unmappedFeatures).toEqual([expect.objectContaining({ externalId: "FX-unmapped" })]);
    expect(rec!.rawRecord).toMatchObject({ providerProductId: "FX-100" });

    const types = (await db().select().from(reviewItems)).map((r) => r.itemType).sort();
    expect(types).toEqual(["image_rights", "new_product"]);
  });

  it("is idempotent: the same payload changes nothing; concurrent runs create one product", async () => {
    const [a, b] = await Promise.all([run(record()), run(record())]);
    expect([a.status, b.status].sort()).toEqual(["created", "unchanged"]);
    const snapshot = [
      await tableCount(products),
      await tableCount(productVariants),
      await tableCount(reviewItems),
    ];
    expect((await run(record())).status).toBe("unchanged");
    expect([
      await tableCount(products),
      await tableCount(productVariants),
      await tableCount(reviewItems),
    ]).toEqual(snapshot);
  });

  it("blocks records with an unknown brand or an unmapped category", async () => {
    expect(await run(record({ brand: "Nobrand" }))).toMatchObject({
      status: "blocked",
      notes: [expect.stringMatching(/Unknown brand/)],
    });
    expect(await run(record({ categoryExternalId: "fx-unknown" }))).toMatchObject({
      status: "blocked",
    });
    expect(await tableCount(products)).toBe(0);
  });

  it("refuses to store data from a cross-check-only source", async () => {
    await expect(
      run(record(), { src: { ...source, licence: { ...LICENCE, usage: "cross_check_only" } } }),
    ).rejects.toThrow(/cross-check/);
  });
});

describe("updating from a provider", () => {
  it("updates its own values, but never hand-edited, verified or published data", async () => {
    const first = await run(record());
    const id = first.productId!;
    // The provider changes a spec it supplied → applied.
    const changed = record({
      payloadHash: "2".repeat(64),
      features: [
        f("FX-storage", "256", "GB"),
        f("FX-ram", "8", "GB"),
        f("FX-battery", "5100", "mAh"),
      ],
    });
    expect((await run(changed)).status).toBe("updated");
    const battery = async () =>
      (
        await db().execute<{ v: number }>(sql`
        SELECT s.value_numeric::float AS v FROM product_specifications s JOIN specification_definitions d ON d.id = s.specification_definition_id
        WHERE s.product_id = ${id} AND d.key = 'battery_capacity'`)
      )[0]!.v;
    expect(await battery()).toBe(5100);

    // An admin edits the model number by hand → the provider's different value is queued, not applied.
    await updateProduct({ db: db(), actorId: null }, id, { modelNumber: "NK-A9-EDITED" });
    const out = await run(
      record({ payloadHash: "3".repeat(64), modelNumber: "NK-A9", features: changed.features }),
    );
    expect((await getProductById(db(), id))!.modelNumber).toBe("NK-A9-EDITED");
    expect(out.changes).toContainEqual({ field: "model_number", decision: "conflict" });
    const conflicts = await db()
      .select()
      .from(reviewItems)
      .where(sql`${reviewItems.itemType} = 'field_conflict'`);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.payload).toMatchObject({
      field: "modelNumber",
      current: "NK-A9-EDITED",
      proposed: "NK-A9",
    });
    // Re-running does not queue the same conflict twice.
    await run(
      record({ payloadHash: "4".repeat(64), modelNumber: "NK-A9", features: changed.features }),
    );
    expect(
      await db()
        .select()
        .from(reviewItems)
        .where(sql`${reviewItems.itemType} = 'field_conflict'`),
    ).toHaveLength(1);

    // Approving the conflict applies the provider value.
    await approveReviewItem(ctx(), conflicts[0]!.id);
    expect((await getProductById(db(), id))!.modelNumber).toBe("NK-A9");

    // Published (editor-verified) products: spec changes go to review.
    await publishProduct(ctx(), id);
    const after = await run(
      record({ payloadHash: "5".repeat(64), features: [f("FX-battery", "5200", "mAh")] }),
    );
    expect(after.changes).toContainEqual({ field: "spec:battery_capacity", decision: "conflict" });
    expect(await battery()).toBe(5100);
    expect((await getProductById(db(), id))!.status).toBe("published"); // imports never change status
  });

  it("does not overwrite a value with a lower-confidence one from another source", async () => {
    const id = (await run(record(), { confidence: 0.9 })).productId!;
    const out = await run(
      record({
        provider: "wikidata",
        payloadHash: "6".repeat(64),
        features: [f("FX-battery", "4900", "mAh")],
      }),
      { src: otherSource, confidence: 0.5 },
    );
    expect(out.changes).toContainEqual({
      field: "spec:battery_capacity",
      decision: "lower_confidence",
    });
    expect(
      await db()
        .select()
        .from(reviewItems)
        .where(sql`${reviewItems.itemType} = 'conflicting_value'`),
    ).toHaveLength(0);
    const rows = await db()
      .select()
      .from(fieldProvenance)
      .where(
        and(eq(fieldProvenance.productId, id), eq(fieldProvenance.field, "spec:battery_capacity")),
      );
    expect(rows.map((r) => [r.sourceId, r.isCurrent]).sort()).toEqual(
      [
        [source.id, true],
        [otherSource.id, false],
      ].sort(),
    );
  });

  it("queues a verified spec value instead of overwriting it", async () => {
    const id = (await run(record())).productId!;
    await setSpecificationValue(ctx(), {
      productId: id,
      key: "battery_capacity",
      value: "5000 mAh",
      verificationStatus: "verified",
    });
    const out = await run(
      record({ payloadHash: "7".repeat(64), features: [f("FX-battery", "4000", "mAh")] }),
    );
    expect(out.status).toBe("needs_review");
    expect(
      await db()
        .select()
        .from(reviewItems)
        .where(sql`${reviewItems.itemType} = 'conflicting_value'`),
    ).toHaveLength(1);
  });
});

describe("identity and variants", () => {
  it("adds a second configuration as a new variant of the same product", async () => {
    const first = await run(record());
    const second = await run(
      record({
        providerProductId: "FX-101",
        gtins: [G2],
        mpn: "NKA9-512-BK",
        payloadHash: "8".repeat(64),
        features: [f("FX-storage", "512", "GB"), f("FX-ram", "8", "GB")],
      }),
    );
    expect(second).toMatchObject({ status: "updated", productId: first.productId });
    expect(second.variantId).not.toBe(first.variantId);
    const variants = await db()
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, first.productId!));
    expect(variants.map((v) => v.storageConfiguration).sort()).toEqual(["256 GB", "512 GB"]);
    // Storage differs per configuration: stored on the variant, not overwriting the product value.
    const storage = await db().execute<{ variant_id: string | null; v: number }>(sql`
      SELECT s.variant_id, s.value_numeric::float AS v FROM product_specifications s
      JOIN specification_definitions d ON d.id = s.specification_definition_id
      WHERE s.product_id = ${first.productId} AND d.key = 'storage' ORDER BY s.variant_id NULLS FIRST`);
    expect(storage.map((r) => [r.variant_id, r.v])).toEqual([
      [null, 256],
      [second.variantId, 512],
    ]);
  });

  it("does not merge a GTIN match whose configuration differs", async () => {
    await run(record());
    const out = await run(
      record({
        providerProductId: "FX-102",
        payloadHash: "9".repeat(64),
        mpn: null,
        features: [f("FX-storage", "1", "TB")],
      }),
    );
    expect(out.status).toBe("needs_review");
    const [item] = await db()
      .select()
      .from(reviewItems)
      .where(sql`${reviewItems.itemType} = 'duplicate_candidate'`);
    expect(item!.payload).toMatchObject({
      kind: "provider",
      reason: expect.stringMatching(/differ/),
    });
    expect(await tableCount(productVariants)).toBe(1);
  });

  it("only suggests name matches; a reviewer decides", async () => {
    const first = await run(record({ variant: {}, features: [], gtins: [], mpn: null }));
    const similar = record({
      providerProductId: "FX-200",
      name: "Novik Aera 9",
      modelNumber: null,
      mpn: null,
      gtins: [G3],
      variant: {},
      features: [],
      payloadHash: "a".repeat(64),
    });
    const out = await run(similar);
    expect(out.status).toBe("needs_review");
    expect(await tableCount(products)).toBe(1);
    const [item] = await db()
      .select()
      .from(reviewItems)
      .where(sql`${reviewItems.itemType} = 'duplicate_candidate'`);
    expect(
      (item!.payload as { candidates: { rule: string; confidence: number }[] }).candidates[0],
    ).toMatchObject({
      rule: "name",
      confidence: 0.9,
    });
    // Running again does not queue it twice.
    await run(similar);
    expect(
      await db()
        .select()
        .from(reviewItems)
        .where(sql`${reviewItems.itemType} = 'duplicate_candidate'`),
    ).toHaveLength(1);
    // Reviewer: same product → merged (GTIN linked to the existing product).
    await approveReviewItem(ctx(), item!.id, { choice: first.productId! });
    expect(await tableCount(products)).toBe(1);
    const [link] = await db()
      .select()
      .from(productIdentifiers)
      .where(
        and(eq(productIdentifiers.identifierType, "gtin"), eq(productIdentifiers.value, `0${G3}`)),
      );
    expect(link!.productId).toBe(first.productId);
  });

  it("keeps separate when the reviewer says so", async () => {
    await run(record({ variant: {}, features: [], gtins: [], mpn: null }));
    await run(
      record({
        providerProductId: "FX-300",
        modelNumber: null,
        mpn: null,
        gtins: [],
        variant: {},
        features: [],
        payloadHash: "b".repeat(64),
      }),
    );
    const [item] = await db()
      .select()
      .from(reviewItems)
      .where(sql`${reviewItems.itemType} = 'duplicate_candidate'`);
    await approveReviewItem(ctx(), item!.id, { choice: "new" });
    const all = await db().select({ slug: products.slug, status: products.status }).from(products);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((p) => p.slug)).size).toBe(2);
    expect(all.every((p) => p.status === "needs_review")).toBe(true);
  });

  it("sends an ambiguous configuration to review and applies the reviewer's choice", async () => {
    const first = await run(record());
    await run(
      record({
        providerProductId: "FX-101",
        gtins: [G2],
        mpn: "NKA9-512-BK",
        payloadHash: "c".repeat(64),
        features: [f("FX-storage", "512", "GB")],
      }),
    );
    // Same model, no GTIN/MPN, only the colour: both variants are possible.
    const out = await run(
      record({
        providerProductId: "FX-400",
        gtins: [],
        mpn: null,
        features: [],
        payloadHash: "d".repeat(64),
      }),
    );
    expect(out.status).toBe("needs_review");
    const [item] = await db()
      .select()
      .from(reviewItems)
      .where(sql`${reviewItems.itemType} = 'variant_ambiguity'`);
    await approveReviewItem(ctx(), item!.id, { choice: first.variantId! });
    const [link] = await db()
      .select()
      .from(productIdentifiers)
      .where(
        and(
          eq(productIdentifiers.identifierType, "provider_product_id"),
          eq(productIdentifiers.value, "FX-400"),
        ),
      );
    expect(link).toMatchObject({ productId: first.productId, variantId: first.variantId });
  });
});

describe("unmapped feature report", () => {
  it("lists unmapped provider features per category with counts", async () => {
    await run(record());
    await run(
      record({
        providerProductId: "FX-101",
        gtins: [G2],
        mpn: "NKA9-512-BK",
        payloadHash: "e".repeat(64),
        features: [f("FX-storage", "512", "GB"), f("FX-unmapped", "no"), f("FX-other", "3", "x")],
      }),
    );
    const report = await unmappedFeatureReport(db(), "icecat");
    expect(report.map((r) => [r.categorySlug, r.externalId, r.products])).toEqual([
      // Both records belong to one product (two configurations): counted once.
      ["smartphones", "FX-other", 1],
      ["smartphones", "FX-unmapped", 1],
    ]);
    expect(await unmappedFeatureReport(db(), "wikidata")).toEqual([]);
  });
});
