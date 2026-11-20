import { sql } from "drizzle-orm";
import { writeCsv } from "@/lib/csv";
import type { DbOrTx } from "@/lib/db";
import { NotFoundError } from "@/modules/_shared/errors";
import {
  getEffectiveDefinitions,
  type EffectiveDefinition,
} from "@/modules/specifications/service";
import { OFFER_COLUMNS, PRODUCT_COLUMNS, SPEC_PREFIX } from "./columns";

/** Exports are capped like imports so they always fit back into one import. */
export const MAX_EXPORT_ROWS = 10_000;

type SpecCells = {
  value_text: string | null;
  value_numeric: string | null;
  value_boolean: boolean | null;
  value_date: string | null;
  value_json: string[] | null;
};

/** A stored value as an import-ready cell: numbers carry their canonical unit ("1000 GB"). */
export function specCell(
  def: Pick<EffectiveDefinition, "dataType" | "canonicalUnit">,
  v: SpecCells | undefined,
): string {
  if (!v) return "";
  switch (def.dataType) {
    case "integer":
    case "decimal":
      return v.value_numeric === null
        ? ""
        : `${Number(v.value_numeric)}${def.canonicalUnit ? ` ${def.canonicalUnit}` : ""}`;
    case "boolean":
      return v.value_boolean === null ? "" : v.value_boolean ? "yes" : "no";
    case "date":
      return v.value_date ?? "";
    case "multi_select":
      return (v.value_json ?? []).join("; ");
    default:
      return v.value_text ?? "";
  }
}

async function categoryBySlug(db: DbOrTx, slug: string) {
  const [c] = await db.execute<{ id: string; slug: string }>(
    sql`SELECT id, slug FROM categories WHERE slug = ${slug}`,
  );
  if (!c) throw new NotFoundError("Category", slug);
  return c;
}

const specHeaders = (defs: EffectiveDefinition[]) => defs.map((d) => `${SPEC_PREFIX}${d.key}`);

/** Products template: base columns plus one `spec.<key>` column per definition of the category. */
export async function productsTemplateCsv(
  db: DbOrTx,
  categorySlug: string | null,
): Promise<string> {
  const defs = categorySlug
    ? await getEffectiveDefinitions(db, (await categoryBySlug(db, categorySlug)).id)
    : [];
  return writeCsv([[...PRODUCT_COLUMNS, ...specHeaders(defs)]]);
}

export function offersTemplateCsv(): string {
  return writeCsv([[...OFFER_COLUMNS]]);
}

/**
 * Products of one category in the import format: one row per variant (one row for a product
 * without variants), with each variant's effective specification values.
 */
export async function exportProductsCsv(db: DbOrTx, categorySlug: string): Promise<string> {
  const category = await categoryBySlug(db, categorySlug);
  const defs = await getEffectiveDefinitions(db, category.id);
  const rows = await db.execute<{
    product_id: string;
    brand: string;
    product_name: string;
    model_number: string | null;
    product_mpn: string | null;
    product_status: string;
    release_date: string | null;
    is_demo: boolean;
    variant_id: string | null;
    variant_name: string | null;
    variant_code: string | null;
    region_code: string | null;
    color: string | null;
    memory: string | null;
    storage: string | null;
    gtin: string | null;
    variant_mpn: string | null;
    source_name: string | null;
    source_url: string | null;
  }>(sql`
    SELECT p.id AS product_id, b.name AS brand, p.name AS product_name, p.model_number, p.manufacturer_part_number AS product_mpn,
           p.product_status, p.release_date::text, p.is_demo,
           v.id AS variant_id, v.variant_name, v.variant_code, v.region_code, v.color, v.memory_configuration AS memory,
           v.storage_configuration AS storage, v.barcode_gtin AS gtin, v.manufacturer_part_number AS variant_mpn,
           src.source_name, src.source_url
    FROM products p JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_variants v ON v.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT s.source_name, r.source_url FROM product_source_records r JOIN sources s ON s.id = r.source_id
      WHERE r.product_id = p.id AND r.variant_id IS NULL ORDER BY s.source_name LIMIT 1
    ) src ON true
    WHERE p.category_id = ${category.id} AND p.publication_status <> 'archived'
    ORDER BY b.name, p.name, v.is_default DESC NULLS LAST, v.variant_code
    LIMIT ${MAX_EXPORT_ROWS}`);
  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const values = productIds.length
    ? await db.execute<
        SpecCells & { product_id: string; variant_id: string | null; definition_id: string }
      >(sql`
        SELECT product_id, variant_id, specification_definition_id AS definition_id, value_text, value_numeric::text,
               value_boolean, value_date::text, value_json
        FROM product_specifications WHERE product_id = ANY(${sql.param(productIds)}::uuid[])`)
    : [];
  const index = new Map(
    values.map((v) => [`${v.product_id}|${v.variant_id ?? ""}|${v.definition_id}`, v]),
  );

  const out: string[][] = [[...PRODUCT_COLUMNS, ...specHeaders(defs)]];
  for (const r of rows) {
    const resolved = (defId: string) =>
      (r.variant_id ? index.get(`${r.product_id}|${r.variant_id}|${defId}`) : undefined) ??
      index.get(`${r.product_id}||${defId}`);
    const base: Record<(typeof PRODUCT_COLUMNS)[number], string> = {
      brand: r.brand,
      category_slug: category.slug,
      product_name: r.product_name,
      model_number: r.model_number ?? "",
      mpn: (r.variant_id ? r.variant_mpn : r.product_mpn) ?? "",
      product_status: r.product_status,
      release_date: r.release_date ?? "",
      variant_name: r.variant_name ?? "",
      variant_code: r.variant_code ?? "",
      region_code: r.region_code ?? "",
      color: r.color ?? "",
      memory: r.memory ?? "",
      storage: r.storage ?? "",
      gtin: r.gtin ?? "",
      source_name: r.source_name ?? "",
      source_url: r.source_url ?? "",
      is_demo: r.is_demo ? "true" : "false",
    };
    out.push([
      ...PRODUCT_COLUMNS.map((c) => base[c]),
      ...defs.map((d) => specCell(d, resolved(d.id))),
    ]);
  }
  return writeCsv(out);
}

/** Offers in the import format (optionally one retailer's). */
export async function exportOffersCsv(db: DbOrTx, retailerSlug: string | null): Promise<string> {
  const rows = await db.execute<Record<(typeof OFFER_COLUMNS)[number], string | null>>(sql`
    SELECT r.slug AS retailer_slug, b.name AS brand, p.model_number AS product_model_number, v.barcode_gtin AS gtin,
           v.variant_code, o.market_country_code, o.currency, o.price_amount::numeric::text AS price,
           o.original_price_amount::numeric::text AS original_price, o.shipping_cost::numeric::text AS shipping_cost,
           o.condition::text, o.availability_status::text AS availability, o.product_url, o.affiliate_url,
           to_char(o.last_checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_checked_at,
           to_char(o.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at,
           CASE WHEN o.is_demo THEN 'true' ELSE 'false' END AS is_demo
    FROM retailer_offers o JOIN retailers r ON r.id = o.retailer_id JOIN products p ON p.id = o.product_id
    JOIN brands b ON b.id = p.brand_id LEFT JOIN product_variants v ON v.id = o.variant_id
    WHERE o.is_active ${retailerSlug ? sql`AND r.slug = ${retailerSlug}` : sql``}
    ORDER BY r.slug, b.name, p.name, v.variant_code NULLS FIRST, o.market_country_code, o.condition
    LIMIT ${MAX_EXPORT_ROWS}`);
  return writeCsv([[...OFFER_COLUMNS], ...rows.map((r) => OFFER_COLUMNS.map((c) => r[c] ?? ""))]);
}
