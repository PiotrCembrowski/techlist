/**
 * Wikidata + Commons adapter through the real job runner, quota ledger, cache and import pipeline.
 * SYNTHETIC responses only (tests/fixtures/wikidata.ts); `fetch` is replaced, so no request leaves
 * the process.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  categories,
  importJobItems,
  productImages,
  products,
  reviewItems,
  sources,
  specificationDefinitions,
} from "@/db/schema";
import { parseEnv } from "@/config/env";
import { closeDb } from "@/lib/db";
import { setLogSink } from "@/lib/log";
import { createBrand } from "@/modules/brands/service";
import { bootstrapCatalog } from "@/modules/import-core/bootstrap";
import { workLoop } from "@/modules/import-jobs/runner";
import { enqueueProviderJob } from "@/modules/import-jobs/service";
import { ensureProviderSource } from "@/modules/import-jobs/sources";
import { getProductGallery } from "@/modules/media/public";
import { getReviewDetails } from "@/modules/review-queue/details";
import { setProductStatus } from "@/modules/products/service";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import { httpClientFor } from "@/modules/providers/core/config";
import { resetRequestSpacing } from "@/modules/providers/core/http";
import { getAdapter, unregisterAdapter } from "@/modules/providers/core/registry";
import { setProviderEnabled } from "@/modules/providers/core/settings";
import { ENTITY, IMAGEINFO, LABELS } from "../fixtures/wikidata";
import { ctx, db, truncateAll } from "./helpers";

const env = parseEnv({
  DATABASE_URL: "postgres://u:p@localhost/db",
  AUTH_SECRET: "x".repeat(32),
  WIKIDATA_USER_AGENT: "Specbase-test-bot/1.0 (https://example.test/contact)",
  IMPORT_JOB_MAX_ITEMS: "20",
});
const future = () => new Date(Date.now() + 60_000);

const requested: URL[] = [];
let maxlag = false;
const fakeFetch = vi.fn(async (input: string | URL | Request) => {
  const u = new URL(String(input));
  requested.push(u);
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  if (maxlag) return json({ error: { code: "maxlag", info: "Waiting for a replica" } });
  if (u.host === "commons.wikimedia.org") return json(IMAGEINFO);
  const ids = (u.searchParams.get("ids") ?? "").split("|");
  if (ids.includes("Q990001")) return json({ entities: { Q990001: ENTITY } });
  return json({
    entities: Object.fromEntries(
      ids.map((id) => [id, (LABELS as Record<string, unknown>)[id] ?? { id, missing: "" }]),
    ),
  });
});

beforeEach(async () => {
  await truncateAll();
  setLogSink(() => {});
  resetRequestSpacing();
  requested.length = 0;
  maxlag = false;
  vi.stubGlobal("fetch", fakeFetch);
  await bootstrapCatalog(ctx());
  await createBrand(ctx(), { name: "Zorvik" });
  ensureAdaptersRegistered(env);
  await setProviderEnabled(ctx(), "wikidata", true, env);
  await ensureProviderSource(ctx(), getAdapter("wikidata")!);
  await db()
    .update(sources)
    .set({ usagePermitted: true })
    .where(eq(sources.providerKey, "wikidata"));
  const [phones] = await db().select().from(categories).where(eq(categories.slug, "smartphones"));
  const defs = await db()
    .select()
    .from(specificationDefinitions)
    .where(eq(specificationDefinitions.categoryId, phones!.id));
  const defId = (k: string) => defs.find((d) => d.key === k)!.id;
  await db().execute(sql`
    INSERT INTO provider_mappings (provider, mapping_type, external_id, target_category_id)
    VALUES ('wikidata', 'category', 'Q990101', ${phones!.id})`);
  for (const [ext, key] of [
    ["P990010", "storage"],
    ["P990011", "battery_capacity"],
    ["P990013", "operating_system"],
  ] as const)
    await db().execute(sql`
      INSERT INTO provider_mappings (provider, mapping_type, external_id, target_definition_id)
      VALUES ('wikidata', 'feature', ${ext}, ${defId(key)})`);
});
afterEach(() => {
  setLogSink();
  vi.unstubAllGlobals();
  unregisterAdapter("wikidata");
});
afterAll(closeDb);

describe("Wikidata import", () => {
  it("never caches a maxlag error and asks to retry later", async () => {
    maxlag = true;
    const adapter = getAdapter("wikidata")!;
    await expect(
      adapter.fetchById!("Q990001", { db: db(), http: httpClientFor(adapter, env, db()) }),
    ).rejects.toMatchObject({ retryable: true, retryAfterMs: 5_000 });
    const [cached] = await db().execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM provider_response_cache WHERE provider = 'wikidata'`);
    expect(Number(cached!.n)).toBe(0);
  });

  it("imports an item for review with its Commons image, credit and file page", async () => {
    const job = await enqueueProviderJob(ctx(), env, {
      provider: "wikidata",
      query: { mode: "ids", values: ["Q990001"] },
    });
    await workLoop(db(), { env, workerId: "test-worker", deadline: future(), drain: true });

    expect(requested.map((u) => u.host)).toEqual([
      "www.wikidata.org",
      "www.wikidata.org",
      "commons.wikimedia.org",
    ]);
    const [jobItem] = await db()
      .select()
      .from(importJobItems)
      .where(eq(importJobItems.jobId, job.id));
    expect(jobItem).toMatchObject({ status: "applied", error: null });

    const [product] = await db().select().from(products);
    expect(product).toMatchObject({ name: "Pell 3", status: "needs_review" });
    expect(String(product!.releaseDate)).toMatch(/^2026-03-03/);
    const specs = await db().execute<{
      key: string;
      raw_value: string;
      raw_unit: string | null;
    }>(sql`
      SELECT d.key, s.raw_value, s.raw_unit FROM product_specifications s
      JOIN specification_definitions d ON d.id = s.specification_definition_id
      WHERE s.product_id = ${product!.id} ORDER BY d.key`);
    expect(specs.map((s) => [s.key, s.raw_value, s.raw_unit])).toEqual([
      ["battery_capacity", "4500", "milliampere hour"],
      ["operating_system", "Fixture OS 3", null],
      ["storage", "128", "gigabyte"],
    ]);

    // The image: per-file licence and credit, waiting for an editor's rights decision.
    const [img] = await db().select().from(productImages);
    expect(img).toMatchObject({
      remoteUrl: expect.stringMatching(/^https:\/\/upload\.wikimedia\.org\//),
      rightsStatus: "needs_review",
      author: "A. Fixture",
      licenseType: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionText: "A. Fixture, CC BY-SA 4.0, via Wikimedia Commons",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Zorvik_Pell_3_front.jpg",
    });
    const [review] = await db()
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.itemType, "image_rights"));
    // The editor sees the file page, the credit line and the file's reuse restrictions.
    const facts = (await getReviewDetails(db(), review!)).facts;
    expect(facts).toEqual(
      expect.arrayContaining([
        {
          label: "File page",
          value: "https://commons.wikimedia.org/wiki/File:Zorvik_Pell_3_front.jpg",
          href: "https://commons.wikimedia.org/wiki/File:Zorvik_Pell_3_front.jpg",
        },
        { label: "Credit line shown", value: "A. Fixture, CC BY-SA 4.0, via Wikimedia Commons" },
        { label: "Reuse restrictions", value: "trademarked" },
      ]),
    );

    // Not public until approved; then shown with its credit linking to the file page.
    expect(await getProductGallery(db(), product!.id, null)).toEqual([]);
    await db().update(productImages).set({ rightsStatus: "approved" });
    await setProductStatus(ctx(), product!.id, "published");
    const [shown] = await getProductGallery(db(), product!.id, null);
    expect(shown).toMatchObject({
      attribution: "A. Fixture, CC BY-SA 4.0, via Wikimedia Commons",
      attributionUrl: "https://commons.wikimedia.org/wiki/File:Zorvik_Pell_3_front.jpg",
    });

    // Every request went through the per-minute ledger.
    const [usage] = await db().execute<{ used: number }>(sql`
      SELECT coalesce(sum(used), 0)::int AS used FROM provider_quota_usage
      WHERE provider = 'wikidata' AND bucket = 'requests'`);
    expect(Number(usage!.used)).toBe(requested.length);
  });
});
