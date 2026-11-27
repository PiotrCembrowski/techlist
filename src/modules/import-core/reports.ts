import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";

export interface UnmappedFeatureRow {
  categorySlug: string;
  categoryName: string;
  externalId: string;
  name: string;
  /** Products whose latest record from the provider has this unmapped feature. */
  products: number;
  exampleValue: string | null;
  exampleUnit: string | null;
}

/**
 * Provider features with no mapping yet, per category, most frequent first — the list to add
 * mappings from. Built from the unmapped features kept on each source record.
 */
export async function unmappedFeatureReport(
  db: DbOrTx,
  provider: string,
  opts: { categoryId?: string; limit?: number } = {},
): Promise<UnmappedFeatureRow[]> {
  const rows = await db.execute<{
    category_slug: string;
    category_name: string;
    external_id: string;
    name: string;
    products: number;
    example_value: string | null;
    example_unit: string | null;
  }>(sql`
    SELECT c.slug AS category_slug, c.name AS category_name,
           f->>'externalId' AS external_id, min(f->>'name') AS name,
           count(DISTINCT r.product_id)::int AS products,
           min(f->>'value') AS example_value, min(f->>'unit') AS example_unit
    FROM product_source_records r
    JOIN sources s ON s.id = r.source_id AND s.provider_key = ${provider}
    JOIN products p ON p.id = r.product_id
    JOIN categories c ON c.id = p.category_id
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.unmapped_features, '[]'::jsonb)) AS f
    WHERE ${opts.categoryId ? sql`p.category_id = ${opts.categoryId}` : sql`TRUE`}
    GROUP BY c.slug, c.name, f->>'externalId'
    ORDER BY c.slug, products DESC, external_id
    LIMIT ${Math.min(opts.limit ?? 500, 5000)}`);
  return rows.map((r) => ({
    categorySlug: r.category_slug,
    categoryName: r.category_name,
    externalId: r.external_id,
    name: r.name,
    products: Number(r.products),
    exampleValue: r.example_value,
    exampleUnit: r.example_unit,
  }));
}
