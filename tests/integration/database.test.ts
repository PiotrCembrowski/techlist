import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/db";
import { db } from "./helpers";

afterAll(closeDb);

describe("database", () => {
  it("is PostgreSQL 16+ with pg_trgm and unaccent installed by the migrations", async () => {
    const [v] = await db().execute<{ n: number }>(
      sql`SELECT current_setting('server_version_num')::int AS n`,
    );
    expect(Number(v!.n)).toBeGreaterThanOrEqual(160000);
    const ext = await db().execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension ORDER BY extname`,
    );
    expect(ext.map((e) => e.extname)).toEqual(expect.arrayContaining(["pg_trgm", "unaccent"]));
  });

  it("has every table from the data model", async () => {
    const rows = await db().execute<{ t: string }>(
      sql`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = rows.map((r) => r.t);
    for (const t of [
      "brands",
      "categories",
      "product_families",
      "products",
      "product_variants",
      "specification_groups",
      "specification_definitions",
      "product_specifications",
      "sources",
      "product_source_records",
      "product_links",
      "product_images",
      "product_relationships",
      "retailers",
      "retailer_offers",
      "price_history",
      "affiliate_clicks",
      "guides",
      "guide_products",
      "guide_categories",
      "featured_comparisons",
      "slug_redirects",
      "import_jobs",
      "import_rows",
      "review_items",
      "admin_users",
      "audit_logs",
      "rate_limits",
    ]) {
      expect(names, t).toContain(t);
    }
  });

  it("sb_unaccent is immutable (usable in indexes)", async () => {
    const [r] = await db().execute<{ v: string; vol: string }>(
      sql`SELECT sb_unaccent('Ébène') AS v, provolatile AS vol FROM pg_proc WHERE proname = 'sb_unaccent'`,
    );
    expect(r).toEqual({ v: "Ebene", vol: "i" });
  });
});
