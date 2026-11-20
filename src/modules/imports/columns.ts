/** CSV column definitions for the import/export templates (SPEC §9.6). */

export const PRODUCT_COLUMNS = [
  "brand",
  "category_slug",
  "product_name",
  "model_number",
  "mpn",
  "product_status",
  "release_date",
  "variant_name",
  "variant_code",
  "region_code",
  "color",
  "memory",
  "storage",
  "gtin",
  "source_name",
  "source_url",
  // Not in the SPEC list: marks fictional records (rule 2.1.2) so sample files stay demo data.
  "is_demo",
] as const;

export const OFFER_COLUMNS = [
  "retailer_slug",
  // One of these identifies the product; `brand` disambiguates model numbers shared by brands.
  "brand",
  "product_model_number",
  "gtin",
  "variant_code",
  "market_country_code",
  "currency",
  "price",
  "original_price",
  "shipping_cost",
  "condition",
  "availability",
  "product_url",
  "affiliate_url",
  "last_checked_at",
  "expires_at",
  "is_demo",
] as const;

export type ImportType = "products" | "offers";
export const SPEC_PREFIX = "spec.";

export const REQUIRED_COLUMNS: Record<ImportType, string[]> = {
  products: ["brand", "category_slug", "product_name"],
  offers: ["retailer_slug", "market_country_code", "currency", "price", "product_url"],
};

export function baseColumns(type: ImportType): readonly string[] {
  return type === "products" ? PRODUCT_COLUMNS : OFFER_COLUMNS;
}

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/** Header aliases accepted by auto-mapping (normalized form → target column). */
const ALIASES: Record<string, string> = {
  name: "product_name",
  product: "product_name",
  category: "category_slug",
  model: "model_number",
  manufacturer_part_number: "mpn",
  status: "product_status",
  ean: "gtin",
  upc: "gtin",
  barcode: "gtin",
  variant: "variant_name",
  region: "region_code",
  colour: "color",
  ram: "memory",
  retailer: "retailer_slug",
  market: "market_country_code",
  country: "market_country_code",
  url: "product_url",
  model_number: "product_model_number",
};

/**
 * Auto-maps file headers to target columns by name (case/space/dash-insensitive), aliases, and
 * `spec.<key>` columns. Each target is used at most once; unknown headers are left unmapped ("").
 */
export function autoMap(
  type: ImportType,
  headers: string[],
  specKeys: string[] = [],
): Record<string, string> {
  const targets = new Set<string>(baseColumns(type));
  const specs = new Set(specKeys);
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const h of headers) {
    const n = norm(h);
    let target = "";
    if (n.startsWith(SPEC_PREFIX)) {
      const key = n.slice(SPEC_PREFIX.length);
      if (type === "products" && (specs.size === 0 || specs.has(key)))
        target = `${SPEC_PREFIX}${key}`;
    } else if (targets.has(n)) target = n;
    else if (ALIASES[n] && targets.has(ALIASES[n]!)) target = ALIASES[n]!;
    if (target && !used.has(target)) {
      used.add(target);
      out[h] = target;
    } else out[h] = "";
  }
  return out;
}

/** Applies a header→target mapping to a raw record. Unmapped headers are dropped. */
export function applyMapping(
  raw: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [header, target] of Object.entries(mapping)) {
    if (target && header in raw) out[target] = raw[header] ?? "";
  }
  return out;
}

/** Checks a mapping: known targets, no target twice, required targets present. */
export function checkMapping(type: ImportType, mapping: Record<string, string>): string[] {
  const errors: string[] = [];
  const targets = Object.values(mapping).filter(Boolean);
  const allowed = new Set<string>(baseColumns(type));
  const seen = new Set<string>();
  for (const t of targets) {
    if (!allowed.has(t) && !(type === "products" && /^spec\.[a-z0-9_]{1,64}$/.test(t)))
      errors.push(`Unknown column "${t}"`);
    if (seen.has(t)) errors.push(`"${t}" is mapped twice`);
    seen.add(t);
  }
  for (const r of REQUIRED_COLUMNS[type]) if (!seen.has(r)) errors.push(`Map a column to "${r}"`);
  if (type === "offers" && !seen.has("product_model_number") && !seen.has("gtin")) {
    errors.push('Map a column to "product_model_number" or "gtin"');
  }
  return errors;
}
