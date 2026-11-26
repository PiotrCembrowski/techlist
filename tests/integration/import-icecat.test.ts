/**
 * Open Icecat adapter through the real job runner, quota ledger, cache and import pipeline.
 * SYNTHETIC responses only (shapes from Icecat's Product JSON manual v3.1; brand, product, IDs
 * and values invented; GTINs use the GS1 restricted-circulation prefix 2). `fetch` is replaced,
 * so no request leaves the process.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  categories,
  importJobItems,
  products,
  productSpecifications,
  sources,
  specificationDefinitions,
} from "@/db/schema";
import { parseEnv } from "@/config/env";
import { closeDb } from "@/lib/db";
import { setLogSink } from "@/lib/log";
import { gtinCheckDigit } from "@/lib/validation";
import { createBrand } from "@/modules/brands/service";
import { bootstrapCatalog } from "@/modules/import-core/bootstrap";
import { workLoop } from "@/modules/import-jobs/runner";
import { enqueueProviderJob } from "@/modules/import-jobs/service";
import { ensureProviderSource } from "@/modules/import-jobs/sources";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import { resetRequestSpacing } from "@/modules/providers/core/http";
import { getAdapter, unregisterAdapter } from "@/modules/providers/core/registry";
import { setProviderEnabled } from "@/modules/providers/core/settings";
import { ctx, db, truncateAll } from "./helpers";

const env = parseEnv({
  DATABASE_URL: "postgres://u:p@localhost/db",
  AUTH_SECRET: "x".repeat(32),
  ICECAT_USERNAME: "fixture-user",
  IMPORT_JOB_MAX_ITEMS: "20",
});
const future = () => new Date(Date.now() + 60_000);
const g13 = (body12: string) => `${body12}${gtinCheckDigit(body12)}`;
const FOUND = g13("200000004001");
const FULL_ONLY = g13("200000004002");
const MISSING = g13("200000004003");

const sheet = {
  msg: "OK",
  data: {
    GeneralInfo: {
      IcecatId: 990101,
      ReleaseDate: "03-03-2026",
      Title: 'Zorvik Pell 3 Fixture Smartphone 15.5 cm (6.1") 128 GB',
      TitleInfo: {
        GeneratedIntTitle: "Zorvik Pell 3",
        GeneratedLocalTitle: { Value: "Zorvik Pell 3", Language: "EN" },
      },
      Brand: "Zorvik",
      BrandPartCode: "ZP3-128-BK",
      GTIN: [FOUND],
      Category: { CategoryID: "990-phones", Name: { Value: "Smartphones", Language: "EN" } },
      ProductFamily: { Value: "Pell", Language: "EN" },
      Description: { LongDesc: "Synthetic fixture description.", Language: "EN" },
    },
    FeaturesGroups: [
      {
        FeatureGroup: { ID: "1", Name: { Value: "Display", Language: "EN" } },
        Features: [
          {
            Value: "15.5",
            RawValue: "15.5",
            Feature: {
              ID: "990944",
              Measure: { Signs: { _: "cm" } },
              Name: { Value: "Display diagonal", Language: "EN" },
            },
          },
          {
            Value: "128",
            RawValue: "128",
            Feature: {
              ID: "990211",
              Measure: { Signs: { _: "GB" } },
              Name: { Value: "Internal storage capacity", Language: "EN" },
            },
          },
          {
            Value: "Fixture glass",
            RawValue: "Fixture glass",
            Feature: { ID: "990777", Name: { Value: "Screen protection", Language: "EN" } },
          },
        ],
      },
    ],
    CatalogObjectCloud: {},
    DemoAccount: false,
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const requested: URL[] = [];
const fakeFetch = vi.fn(async (input: string | URL | Request) => {
  const url = new URL(String(input));
  requested.push(url);
  const gtin = url.searchParams.get("GTIN")?.replace(/^0+/, "");
  const id = url.searchParams.get("icecat_id");
  if (gtin === FOUND || id === "990101") return json(sheet);
  if (gtin === FULL_ONLY)
    return json({ StatusCode: 9, Code: 403, Error: "Forbidden", Message: "synthetic" }, 403);
  return json({ StatusCode: 16, Code: 400, Error: "Bad Request", Message: "synthetic" }, 400);
});

beforeEach(async () => {
  await truncateAll();
  setLogSink(() => {});
  resetRequestSpacing();
  requested.length = 0;
  vi.stubGlobal("fetch", fakeFetch);
  await bootstrapCatalog(ctx());
  await createBrand(ctx(), { name: "Zorvik" });
  ensureAdaptersRegistered(env);
  await setProviderEnabled(ctx(), "icecat", true, env);
  await ensureProviderSource(ctx(), getAdapter("icecat")!);
  await db().update(sources).set({ usagePermitted: true }).where(eq(sources.providerKey, "icecat"));
  const [phones] = await db().select().from(categories).where(eq(categories.slug, "smartphones"));
  const defs = await db()
    .select()
    .from(specificationDefinitions)
    .where(eq(specificationDefinitions.categoryId, phones!.id));
  const defId = (k: string) => defs.find((d) => d.key === k)!.id;
  await db().execute(sql`
    INSERT INTO provider_mappings (provider, mapping_type, external_id, target_category_id)
    VALUES ('icecat', 'category', '990-phones', ${phones!.id})`);
  for (const [ext, key] of [
    ["990944", "screen_size"],
    ["990211", "storage"],
  ] as const)
    await db().execute(sql`
      INSERT INTO provider_mappings (provider, mapping_type, external_id, target_definition_id)
      VALUES ('icecat', 'feature', ${ext}, ${defId(key)})`);
});
afterEach(() => {
  setLogSink();
  vi.unstubAllGlobals();
  unregisterAdapter("icecat");
});
afterAll(closeDb);

describe("Open Icecat import", () => {
  it("imports a free data sheet for review and reports refused and unknown GTINs", async () => {
    const job = await enqueueProviderJob(ctx(), env, {
      provider: "icecat",
      query: { mode: "gtin", values: [FOUND, FULL_ONLY, MISSING] },
    });
    await workLoop(db(), { env, workerId: "test-worker", deadline: future(), drain: true });

    // Only the documented host, the free account and no tokens.
    expect(requested.length).toBeGreaterThanOrEqual(3);
    for (const u of requested) {
      expect(u.host).toBe("live-origin.icecat.biz");
      expect(u.searchParams.get("shopname")).toBe("fixture-user");
    }

    const items = await db()
      .select()
      .from(importJobItems)
      .where(eq(importJobItems.jobId, job.id))
      .orderBy(importJobItems.externalKey);
    const byKey = new Map(items.map((i) => [i.externalKey.replace(/^0+/, ""), i]));
    expect(byKey.get(FOUND)!.status).toBe("applied");
    expect(byKey.get(FULL_ONLY)).toMatchObject({ status: "failed" });
    expect(byKey.get(FULL_ONLY)!.error).toMatch(/Full Icecat only/);
    expect(byKey.get(MISSING)).toMatchObject({ status: "skipped", result: { notFound: true } });

    const [product] = await db().select().from(products);
    expect(product).toMatchObject({ name: "Pell 3", status: "needs_review" });
    const specs = await db()
      .select({
        key: specificationDefinitions.key,
        valueNumeric: productSpecifications.valueNumeric,
        rawValue: productSpecifications.rawValue,
        rawUnit: productSpecifications.rawUnit,
      })
      .from(productSpecifications)
      .innerJoin(
        specificationDefinitions,
        eq(specificationDefinitions.id, productSpecifications.specificationDefinitionId),
      )
      .where(eq(productSpecifications.productId, product!.id));
    const screen = specs.find((s) => s.key === "screen_size");
    expect(screen).toMatchObject({ rawValue: "15.5", rawUnit: "cm" });
    expect(screen!.valueNumeric).toBeCloseTo(6.1, 1);

    // Identifiers, provenance and the quota ledger.
    const ids = await db().execute<{ identifier_type: string; value: string }>(sql`
      SELECT identifier_type, value FROM product_identifiers WHERE product_id = ${product!.id}`);
    expect(ids.map((r) => r.identifier_type).sort()).toEqual(
      expect.arrayContaining(["gtin", "mpn", "provider_product_id"]),
    );
    const [usage] = await db().execute<{ used: number }>(sql`
      SELECT used FROM provider_quota_usage WHERE provider = 'icecat' AND bucket = 'datasheets'`);
    expect(Number(usage!.used)).toBe(requested.length);
    const [unmapped] = await db().execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM product_source_records
      WHERE provider_product_id = '990101' AND unmapped_features::text LIKE '%990777%'`);
    expect(Number(unmapped!.n)).toBe(1);

    // Re-importing the same record changes nothing and is served from the response cache.
    const before = requested.length;
    await enqueueProviderJob(ctx(), env, {
      provider: "icecat",
      query: { mode: "gtin", values: [FOUND] },
    });
    await workLoop(db(), { env, workerId: "test-worker", deadline: future(), drain: true });
    expect(requested.length).toBe(before);
    const count = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.status, "needs_review")));
    expect(Number(count[0]!.n)).toBe(1);
  });
});
