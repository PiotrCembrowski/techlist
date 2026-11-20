/**
 * Performance review on a throwaway database (SPEC §14): loads the demo seed plus N synthetic
 * products, then times the main read paths through the real services and prints EXPLAIN plans
 * for the heaviest queries.
 *
 *   PERF_DATABASE_URL=postgres://…/specbase_perf pnpm perf:bench [--products 20000]
 *
 * The database name must end in "_perf"; its schema is dropped. Synthetic rows ("Benchmark
 * Brand N", "Bench Item N") exist only there and are never served.
 */
import "dotenv/config";
import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { migrateDatabase, resetSchema } from "../db/lib";

const url = process.env.PERF_DATABASE_URL;
if (!url || !/_perf(\?|$)/.test(new URL(url).pathname + (new URL(url).search ? "?" : ""))) {
  console.error(
    "Set PERF_DATABASE_URL to a database whose name ends in _perf (its schema is dropped).",
  );
  process.exit(1);
}
const N = Number(process.argv[process.argv.indexOf("--products") + 1]) || 20_000;
// Services read configuration through getEnv(); point them at the benchmark database.
process.env.DATABASE_URL = url;
process.env.ENABLE_DEMO_DATA = "false";
process.env.AUTH_SECRET ??= "perf-benchmark-secret-not-for-production-0000";

async function main() {
  const { createDb } = await import("../../src/lib/db");
  const { seedDemoData } = await import("../../src/db/seed");
  const { listCatalog } = await import("../../src/modules/catalog/service");
  const { parseCatalogFilters } = await import("../../src/modules/catalog/filters");
  const { PostgresSearchService } = await import("../../src/modules/search/service");
  const { loadProductPage } = await import("../../src/modules/products/public");
  const { sitemapCount, sitemapEntries } = await import("../../src/modules/seo/sitemap");
  const { countIndexableProducts } = await import("../../src/modules/seo/queries");
  const { getCategoryDescendantIds } = await import("../../src/modules/categories/service");

  await resetSchema(url!);
  await migrateDatabase(url!);
  const { db, client } = createDb(url!, 4);
  try {
    await seedDemoData(db);
    console.log(`Loading ${N} synthetic products…`);
    await db.execute(sql`
      INSERT INTO brands (name, slug, is_active, is_demo)
      SELECT 'Benchmark Brand ' || i, 'benchmark-brand-' || i, true, false FROM generate_series(1, 20) i`);
    await db.execute(sql`
      INSERT INTO products (brand_id, category_id, name, slug, model_number, publication_status, verification_status, product_status, release_date, is_demo)
      SELECT b.id, c.id, n.name, 'bench-item-' || i, upper(substr(md5('m' || i), 1, 3)) || '-' || (100 + i % 9000) || substr(md5('x' || i), 1, 2), 'published',
             CASE WHEN i % 4 = 0 THEN 'needs_review' ELSE 'verified' END::verification_status, 'active',
             date '2020-01-01' + (i % 2000), false
      FROM generate_series(1, ${N}) i
      -- Varied, made-up names: two syllable words plus a number, so text search behaves like a real catalogue.
      CROSS JOIN LATERAL (
        SELECT initcap(s1.s || s2.s) || ' ' || initcap(s3.s || s4.s) || ' ' || (i % 97) AS name
        FROM (SELECT (ARRAY['ka','lo','mi','ne','ru','sa','te','vo','zi','qua','bri','cel','dor','fen','gal','hir'])[1 + (hashtext('a' || i) & 15)] AS s) s1,
             (SELECT (ARRAY['ran','tos','vel','mir','dax','lun','pex','sor','tin','wex','yar','zol','bek','cor','dun','fip'])[1 + (hashtext('b' || i) & 15)] AS s) s2,
             (SELECT (ARRAY['ar','be','ci','do','eu','fa','go','hu','io','ja','ke','li','mo','nu','op','pi'])[1 + (hashtext('c' || i) & 15)] AS s) s3,
             (SELECT (ARRAY['nt','rx','lm','sk','vt','qz','mb','gr','th','pl','cr','dw','fn','hk','jl','kv'])[1 + (hashtext('d' || i) & 15)] AS s) s4
      ) n
      JOIN brands b ON b.slug = 'benchmark-brand-' || (1 + i % 20)
      JOIN categories c ON c.slug = CASE WHEN i % 2 = 0 THEN 'laptops' ELSE 'smartphones' END`);
    // Product-level values for every numeric/boolean/text definition of the product's category.
    await db.execute(sql`
      INSERT INTO product_specifications (product_id, specification_definition_id, value_numeric, value_boolean, value_text, origin, verification_status)
      SELECT p.id, d.id,
             CASE WHEN d.data_type IN ('integer', 'decimal')
                  THEN greatest(coalesce((d.validation_rules->>'min')::numeric, 1),
                                least(coalesce((d.validation_rules->>'max')::numeric, 1000), 8 * (1 + (hashtext(p.slug || d.key) & 7))))
             END,
             CASE WHEN d.data_type = 'boolean' THEN (hashtext(p.slug) & 1) = 1 END,
             CASE WHEN d.data_type = 'text' THEN 'Bench value ' || (hashtext(p.slug) & 63)
                  WHEN d.data_type = 'enum' THEN d.validation_rules->'options'->>0 END,
             'import', 'unverified'
      FROM products p JOIN specification_definitions d ON d.category_id = p.category_id
      WHERE p.slug LIKE 'bench-item-%' AND d.data_type IN ('integer', 'decimal', 'boolean', 'text', 'enum')`);
    await db.execute(sql`
      INSERT INTO retailer_offers (retailer_id, product_id, market_country_code, product_url, currency, price_amount, availability_status, last_checked_at, is_demo)
      SELECT r.id, p.id, r.country_code, 'https://' || r.allowed_redirect_hosts[1] || '/bench/' || p.slug, r.supported_currencies[1],
             100 + (hashtext(p.slug) & 2047), 'in_stock', now() - interval '1 hour', true
      FROM products p CROSS JOIN LATERAL (SELECT * FROM retailers ORDER BY slug LIMIT 2) r
      WHERE p.slug LIKE 'bench-item-%' AND hashtext(p.slug) % 4 = 0`);
    await db.execute(sql`ANALYZE`);
    const counts = await db.execute(sql`
      SELECT (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM product_specifications) AS specs,
             (SELECT count(*) FROM retailer_offers) AS offers, (SELECT count(*) FROM indexable_products) AS indexable`);
    console.log(counts[0]);

    const [laptops] = await db.execute<{ id: string }>(
      sql`SELECT id FROM categories WHERE slug = 'laptops'`,
    );
    const scope = [laptops!.id, ...(await getCategoryDescendantIds(db, laptops!.id))];
    const opts = { market: "ALL", staleHours: 72 };
    const search = new PostgresSearchService(db);
    const [ram] = await db.execute<{ id: string }>(
      sql`SELECT id FROM specification_definitions WHERE key = 'ram' AND category_id = ${laptops!.id}`,
    );
    const filterDefs = await db.execute(
      sql`SELECT * FROM specification_definitions WHERE category_id = ${laptops!.id} AND is_filterable`,
    );
    void filterDefs;
    void ram;

    const [sample] = await db.execute<{ name: string; model_number: string }>(
      sql`SELECT name, model_number FROM products WHERE slug = 'bench-item-12345'`,
    );
    if (!sample) throw new Error("benchmark data missing");
    const typo = sample.name.replace(/^(.)(.)/, "$2$1"); // swap the first two letters
    console.log(`sample: "${sample.name}" (${sample.model_number}), typo "${typo}"`);
    const cases: [string, () => Promise<unknown>][] = [
      ["catalog: /products page 1", () => listCatalog(db, {}, parseCatalogFilters({}), opts)],
      [
        "catalog: /products page 200",
        () => listCatalog(db, {}, parseCatalogFilters({ page: "200" }), opts),
      ],
      [
        "catalog: laptops, brand filter",
        () =>
          listCatalog(
            db,
            { categoryIds: scope },
            parseCatalogFilters({ brand: "benchmark-brand-3" }),
            opts,
          ),
      ],
      [
        "catalog: laptops, price sort (PL)",
        () =>
          listCatalog(db, { categoryIds: scope }, parseCatalogFilters({ sort: "price_asc" }), {
            market: "PL",
            staleHours: 72,
            priceCurrency: "PLN",
          }),
      ],
      [
        "search: exact model number",
        () => search.search(sample.model_number, { ...opts, page: 1 }),
      ],
      ["search: words", () => search.search(sample.name, { ...opts, page: 1 })],
      ["search: typo (trigram)", () => search.search(typo, { ...opts, page: 1 })],
      ["search: no match", () => search.search("zzqxj wvvk", { ...opts, page: 1 })],
      ["suggest: prefix", () => search.suggest(sample.name.slice(0, 6))],
      ["product page", () => loadProductPage(db, "benchmark-brand-8", "bench-item-12347")],
      ["indexable count (category)", () => countIndexableProducts(db, { categoryIds: scope })],
      ["sitemap: count", () => sitemapCount(db)],
      ["sitemap: file 0", () => sitemapEntries(db, 0)],
    ];
    console.log("\nMedian of 5 runs (after one warm-up):");
    for (const [name, fn] of cases) {
      await fn();
      const t: number[] = [];
      for (let i = 0; i < 5; i++) {
        const s = performance.now();
        await fn();
        t.push(performance.now() - s);
      }
      t.sort((a, b) => a - b);
      console.log(`  ${name.padEnd(36)} ${t[2]!.toFixed(1).padStart(8)} ms`);
    }

    console.log("\nEXPLAIN: indexable products in a category");
    for (const r of await db.execute<{ "QUERY PLAN": string }>(sql`
      EXPLAIN (ANALYZE, BUFFERS OFF, TIMING OFF) SELECT count(*) FROM sb_indexable_products(${sql.param(scope)}::uuid[], NULL)`)) {
      console.log("  " + r["QUERY PLAN"]);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
