import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSeedAllowed, countRows, seedDemoData } from "@/db/seed";
import { closeDb } from "@/lib/db";
import { db, truncateAll } from "./helpers";

beforeAll(truncateAll);
afterAll(closeDb);

const snapshot = async () =>
  db().execute<{ t: string; max: string | null }>(sql`
    SELECT 'products' AS t, max(updated_at)::text AS max FROM products
    UNION ALL SELECT 'specs', max(updated_at)::text FROM product_specifications
    UNION ALL SELECT 'offers', max(updated_at)::text FROM retailer_offers
    UNION ALL SELECT 'brands', max(updated_at)::text FROM brands`);

describe("demo seed", () => {
  const now = new Date("2026-11-19T12:00:00Z");

  it("seeds, and a second run changes nothing", async () => {
    await seedDemoData(db(), { now });
    const first = await countRows(db());
    expect(first.products).toBeGreaterThanOrEqual(18);
    expect(first.brands).toBeGreaterThanOrEqual(3);
    const before = await snapshot();
    await seedDemoData(db(), { now });
    expect(await countRows(db())).toEqual(first);
    expect(await snapshot()).toEqual(before);
  });

  it("marks every seeded record as demo data", async () => {
    const [r] = await db().execute<Record<string, number>>(sql`
      SELECT (SELECT count(*)::int FROM brands WHERE NOT is_demo) AS brands,
             (SELECT count(*)::int FROM products WHERE NOT is_demo) AS products,
             (SELECT count(*)::int FROM retailers WHERE NOT is_demo) AS retailers,
             (SELECT count(*)::int FROM retailer_offers WHERE NOT is_demo) AS offers,
             (SELECT count(*)::int FROM sources WHERE NOT is_demo) AS sources,
             (SELECT count(*)::int FROM guides WHERE NOT is_demo) AS guides,
             (SELECT count(*)::int FROM admin_users) AS admins,
             (SELECT count(*)::int FROM retailer_offers WHERE product_url !~ '^https://[a-z0-9.-]+\\.example/') AS non_example_urls`);
    expect(r).toEqual({
      brands: 0,
      products: 0,
      retailers: 0,
      offers: 0,
      sources: 0,
      guides: 0,
      admins: 0,
      non_example_urls: 0,
    });
  });

  it("covers each display state the spec asks for", async () => {
    const [r] = await db().execute<Record<string, number>>(sql`
      SELECT
        (SELECT count(*)::int FROM retailer_offers WHERE last_checked_at < ${now.toISOString()}::timestamptz - interval '72 hours') AS stale,
        (SELECT count(*)::int FROM retailer_offers WHERE availability_status = 'out_of_stock') AS out_of_stock,
        (SELECT count(*)::int FROM retailer_offers WHERE condition = 'refurbished') AS refurbished,
        (SELECT count(DISTINCT currency)::int FROM retailer_offers) AS currencies,
        (SELECT count(*)::int FROM product_relationships WHERE relationship_type = 'successor') AS successors,
        (SELECT count(*)::int FROM product_relationships WHERE relationship_type = 'alternative') AS alternatives,
        (SELECT count(*)::int FROM guides) AS guides,
        (SELECT count(*)::int FROM featured_comparisons) AS comparisons,
        (SELECT count(*)::int FROM price_history) AS history,
        (SELECT count(*)::int FROM retailer_offers) AS offers`);
    expect(r!.stale).toBeGreaterThanOrEqual(1);
    expect(r!.out_of_stock).toBeGreaterThanOrEqual(1);
    expect(r!.refurbished).toBeGreaterThanOrEqual(1);
    expect(r!.currencies).toBe(3);
    expect(r!.successors).toBeGreaterThanOrEqual(6); // one per top-level category
    expect(r!.alternatives).toBeGreaterThanOrEqual(6);
    expect(r).toMatchObject({ guides: 2, comparisons: 2 });
    expect(r!.history).toBe(r!.offers); // one price_history row per offer, written on creation
  });

  it("refuses to run in production unless explicitly allowed", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(/Refusing/);
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "true" }),
    ).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
  });
});
