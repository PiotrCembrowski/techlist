import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { toGtin14 } from "@/lib/gtin";
import { parseQuantity } from "@/lib/units";
import { brandKey, nameKey, normalizeMpn } from "./identity";
import type { NormalizedProduct } from "./normalize";

/**
 * Duplicate detection (DECISIONS D79). Priority:
 *   0. the provider's own product ID (already imported from this provider);
 *   1. exact GTIN, then a check that the variant attributes agree;
 *   2. exact MPN + brand;
 *   3. exact model identifier + brand;
 *   4. normalised brand + name → suggestion only;
 *   5. fuzzy name (trigram) → suggestion only.
 * Steps 0–3 are identifier matches and may be applied automatically when they all agree.
 * Steps 4–5 never merge anything: they produce candidates for the duplicate-review queue.
 */

export type MatchRule = "provider_id" | "gtin" | "mpn" | "model" | "name" | "fuzzy";

export interface MatchCandidate {
  productId: string;
  variantId: string | null;
  name: string;
  rule: MatchRule;
  /** 0–1. Identifier rules are 1; name rules are below 1. */
  confidence: number;
  reason: string;
}

export type MatchResult =
  | { kind: "match"; productId: string; variantId: string | null; rule: MatchRule; reason: string }
  | { kind: "new" }
  /** Name/fuzzy suggestions: a person decides (merge, keep separate, link as variant). */
  | { kind: "suggestions"; candidates: MatchCandidate[] }
  /** Identifiers disagree, or a GTIN match has inconsistent variant attributes. */
  | { kind: "conflict"; candidates: MatchCandidate[]; reason: string };

export type BrandResolution =
  | { kind: "found"; brandId: string; name: string }
  | { kind: "unknown" }
  | { kind: "ambiguous"; brandIds: string[] };

/**
 * Brand by provider mapping first, then by brand key against our brands' names and aliases.
 * Unknown brands are never created automatically.
 */
export async function resolveBrand(
  db: DbOrTx,
  provider: string,
  rawBrand: string | null,
): Promise<BrandResolution> {
  const key = brandKey(rawBrand);
  if (!key) return { kind: "unknown" };
  const [mapped] = await db.execute<{ id: string; name: string }>(sql`
    SELECT b.id, b.name FROM provider_mappings m JOIN brands b ON b.id = m.target_brand_id
    WHERE m.provider = ${provider} AND m.mapping_type = 'brand' AND m.action = 'map'
      AND m.external_id = ${key} LIMIT 1`);
  if (mapped) return { kind: "found", brandId: mapped.id, name: mapped.name };
  const rows = await db.execute<{ id: string; name: string; aliases: string[] }>(
    sql`SELECT id, name, aliases FROM brands`,
  );
  const hits = rows.filter(
    (b) => brandKey(b.name) === key || b.aliases.some((a) => brandKey(a) === key),
  );
  if (hits.length === 1) return { kind: "found", brandId: hits[0]!.id, name: hits[0]!.name };
  if (hits.length > 1) return { kind: "ambiguous", brandIds: hits.map((h) => h.id) };
  return { kind: "unknown" };
}

type Row = { product_id: string; variant_id: string | null; name: string };

const arr = (values: string[]) => sql`${sql.param(values)}::text[]`;

async function identifierCandidates(
  db: DbOrTx,
  p: NormalizedProduct,
  brandId: string,
): Promise<MatchCandidate[]> {
  const out: MatchCandidate[] = [];
  const add = (rows: Row[], rule: MatchRule, reason: string) => {
    for (const r of rows)
      out.push({
        productId: r.product_id,
        variantId: r.variant_id,
        name: r.name,
        rule,
        confidence: 1,
        reason,
      });
  };

  add(
    await db.execute<Row>(sql`
      SELECT i.product_id, i.variant_id, p.name FROM product_identifiers i JOIN products p ON p.id = i.product_id
      WHERE i.identifier_type = 'provider_product_id' AND i.provider = ${p.provider} AND i.value = ${p.providerProductId}`),
    "provider_id",
    `Already imported from ${p.provider} (ID ${p.providerProductId})`,
  );

  if (p.gtins.length) {
    add(
      await db.execute<Row>(sql`
        SELECT i.product_id, i.variant_id, p.name FROM product_identifiers i JOIN products p ON p.id = i.product_id
        WHERE i.identifier_type = 'gtin' AND i.value = ANY(${arr(p.gtins)})
        UNION
        SELECT v.product_id, v.id, p.name FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.barcode_gtin IS NOT NULL AND lpad(v.barcode_gtin, 14, '0') = ANY(${arr(p.gtins)})`),
      "gtin",
      `Same GTIN (${p.gtins.join(", ")})`,
    );
  }

  if (p.mpn.value) {
    add(
      await db.execute<Row>(sql`
        SELECT i.product_id, i.variant_id, p.name FROM product_identifiers i JOIN products p ON p.id = i.product_id
        WHERE i.identifier_type = 'mpn' AND i.value = ${p.mpn.value} AND p.brand_id = ${brandId}
        UNION
        SELECT p.id, NULL, p.name FROM products p
        WHERE p.brand_id = ${brandId} AND upper(regexp_replace(p.manufacturer_part_number, '\\s', '', 'g')) = ${p.mpn.value}
        UNION
        SELECT v.product_id, v.id, p.name FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.brand_id = ${brandId} AND upper(regexp_replace(v.manufacturer_part_number, '\\s', '', 'g')) = ${p.mpn.value}`),
      "mpn",
      `Same brand and MPN (${p.mpn.value})`,
    );
  }

  if (p.modelNumber.key) {
    add(
      await db.execute<Row>(sql`
        SELECT i.product_id, i.variant_id, p.name FROM product_identifiers i JOIN products p ON p.id = i.product_id
        WHERE i.identifier_type = 'model_number' AND i.value = ${p.modelNumber.key} AND p.brand_id = ${brandId}
        UNION
        SELECT p.id, NULL, p.name FROM products p
        WHERE p.brand_id = ${brandId} AND regexp_replace(upper(p.model_number), '[^A-Z0-9]', '', 'g') = ${p.modelNumber.key}`),
      "model",
      `Same brand and model number (${p.modelNumber.value})`,
    );
  }
  return out;
}

async function nameCandidates(
  db: DbOrTx,
  p: NormalizedProduct,
  brandId: string,
  brandName: string,
): Promise<MatchCandidate[]> {
  if (!p.name.value) return [];
  const key = nameKey(p.name.value, brandName);
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', '0.5', true)`);
    return tx.execute<{ id: string; name: string; score: number }>(sql`
      SELECT p.id, p.name, similarity(lower(p.name), lower(${p.name.value}))::float AS score
      FROM products p
      WHERE p.brand_id = ${brandId} AND p.name % ${p.name.value}
      ORDER BY score DESC LIMIT 10`);
  });
  const out: MatchCandidate[] = [];
  for (const r of rows) {
    if (key && nameKey(r.name, brandName) === key) {
      out.push({
        productId: r.id,
        variantId: null,
        name: r.name,
        rule: "name",
        confidence: 0.9,
        reason: "Same brand and the same name after normalisation",
      });
    } else if (Number(r.score) >= 0.6) {
      out.push({
        productId: r.id,
        variantId: null,
        name: r.name,
        rule: "fuzzy",
        confidence: Math.round(Number(r.score) * 0.8 * 100) / 100,
        reason: `Similar name (similarity ${Number(r.score).toFixed(2)})`,
      });
    }
  }
  return out;
}

export interface VariantAttributes {
  storage: string | null;
  memory: string | null;
  colour: string | null;
  region: string | null;
}

/** Compares two configuration values: quantities by size ("1 TB" = "1000 GB"), text folded. */
export function sameAttribute(
  kind: keyof VariantAttributes,
  a: string | null,
  b: string | null,
): boolean | null {
  if (!a || !b) return null; // unknown on one side: no evidence either way
  if (kind === "storage" || kind === "memory") {
    try {
      return parseQuantity(a, "GB") === parseQuantity(b, "GB");
    } catch {
      /* fall through to text comparison */
    }
  }
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return fold(a) === fold(b);
}

export function recordAttributes(p: NormalizedProduct): VariantAttributes {
  return {
    storage: p.variant.storage,
    memory: p.variant.memory,
    colour: p.variant.colour.value,
    region: p.variant.region.value,
  };
}

/** Attribute names on which a stored variant and the record disagree. */
export function attributeConflicts(
  stored: VariantAttributes,
  incoming: VariantAttributes,
): (keyof VariantAttributes)[] {
  return (Object.keys(incoming) as (keyof VariantAttributes)[]).filter(
    (k) => sameAttribute(k, stored[k], incoming[k]) === false,
  );
}

async function variantAttributes(db: DbOrTx, variantId: string): Promise<VariantAttributes> {
  const [v] = await db.execute<{
    storage_configuration: string | null;
    memory_configuration: string | null;
    color: string | null;
    region_code: string | null;
  }>(sql`
    SELECT storage_configuration, memory_configuration, color, region_code FROM product_variants WHERE id = ${variantId}`);
  return {
    storage: v?.storage_configuration ?? null,
    memory: v?.memory_configuration ?? null,
    colour: v?.color ?? null,
    region: v?.region_code ?? null,
  };
}

/** Runs the match priority for one normalised record of a known brand. */
export async function findMatch(
  db: DbOrTx,
  p: NormalizedProduct,
  brand: { id: string; name: string },
): Promise<MatchResult> {
  const ids = await identifierCandidates(db, p, brand.id);
  if (ids.length) {
    const products = new Set(ids.map((c) => c.productId));
    if (products.size > 1) {
      return {
        kind: "conflict",
        candidates: dedupe(ids),
        reason: "Identifiers point to different products",
      };
    }
    // The strongest rule decides; a variant-level hit wins over a product-level one.
    const order: MatchRule[] = ["provider_id", "gtin", "mpn", "model"];
    const best = [...ids].sort(
      (a, b) =>
        order.indexOf(a.rule) - order.indexOf(b.rule) ||
        Number(b.variantId !== null) - Number(a.variantId !== null),
    )[0]!;
    const variantIds = new Set(ids.filter((c) => c.variantId).map((c) => c.variantId));
    if (variantIds.size > 1) {
      return {
        kind: "conflict",
        candidates: dedupe(ids),
        reason: "Identifiers point to different variants of the product",
      };
    }
    const variantId = [...variantIds][0] ?? null;
    if (variantId && (best.rule === "gtin" || ids.some((c) => c.rule === "gtin"))) {
      const clash = attributeConflicts(await variantAttributes(db, variantId), recordAttributes(p));
      if (clash.length) {
        return {
          kind: "conflict",
          candidates: dedupe(ids),
          reason: `GTIN matches a variant whose ${clash.join(", ")} differ`,
        };
      }
    }
    return {
      kind: "match",
      productId: best.productId,
      variantId,
      rule: best.rule,
      reason: best.reason,
    };
  }
  const names = await nameCandidates(db, p, brand.id, brand.name);
  return names.length ? { kind: "suggestions", candidates: names } : { kind: "new" };
}

function dedupe(c: MatchCandidate[]): MatchCandidate[] {
  const seen = new Set<string>();
  return c.filter((x) => {
    const k = `${x.productId}|${x.variantId}|${x.rule}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export type VariantResult =
  | { kind: "product_level" }
  | { kind: "existing"; variantId: string; reason: string }
  | { kind: "new" }
  | { kind: "ambiguous"; variantIds: string[]; reason: string };

/**
 * Which variant of a matched product the record describes. A variant is reused only when its
 * GTIN or MPN matches, or exactly one variant agrees on every attribute the record states;
 * several possible variants are ambiguous (review), never merged.
 */
export async function identifyVariant(
  db: DbOrTx,
  productId: string,
  p: NormalizedProduct,
): Promise<VariantResult> {
  const incoming = recordAttributes(p);
  const hasAttributes = Object.values(incoming).some(Boolean);
  const variants = await db.execute<{
    id: string;
    barcode_gtin: string | null;
    manufacturer_part_number: string | null;
    storage_configuration: string | null;
    memory_configuration: string | null;
    color: string | null;
    region_code: string | null;
  }>(sql`
    SELECT id, barcode_gtin, manufacturer_part_number, storage_configuration, memory_configuration, color, region_code
    FROM product_variants WHERE product_id = ${productId} ORDER BY created_at`);

  const byGtin = variants.filter(
    (v) => v.barcode_gtin && p.gtins.includes(toGtin14(v.barcode_gtin) ?? ""),
  );
  if (byGtin.length === 1)
    return { kind: "existing", variantId: byGtin[0]!.id, reason: "same GTIN" };
  const byMpn = p.mpn.value
    ? variants.filter((v) => normalizeMpn(v.manufacturer_part_number) === p.mpn.value)
    : [];
  if (byMpn.length === 1) return { kind: "existing", variantId: byMpn[0]!.id, reason: "same MPN" };

  if (!hasAttributes) {
    if (variants.length === 0 || !p.gtins.length) return { kind: "product_level" };
    // A GTIN identifies one configuration; with existing variants and no attributes we cannot tell which.
    return {
      kind: "ambiguous",
      variantIds: variants.map((v) => v.id),
      reason: "The record has a GTIN but no configuration attributes, and the product has variants",
    };
  }

  const consistent = variants.filter(
    (v) =>
      attributeConflicts(
        {
          storage: v.storage_configuration,
          memory: v.memory_configuration,
          colour: v.color,
          region: v.region_code,
        },
        incoming,
      ).length === 0,
  );
  const exact = consistent.filter((v) =>
    (Object.keys(incoming) as (keyof VariantAttributes)[]).every((k) => {
      const stored = {
        storage: v.storage_configuration,
        memory: v.memory_configuration,
        colour: v.color,
        region: v.region_code,
      }[k];
      return (incoming[k] === null) === (stored === null);
    }),
  );
  if (exact.length === 1)
    return { kind: "existing", variantId: exact[0]!.id, reason: "same configuration" };
  if (exact.length > 1 || consistent.length > 0)
    return {
      kind: "ambiguous",
      variantIds: (exact.length > 1 ? exact : consistent).map((v) => v.id),
      reason: "Several variants could match; the record does not state enough attributes",
    };
  return { kind: "new" };
}
