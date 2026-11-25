import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";

/**
 * Field-level provenance (DECISIONS D79): which source — or which admin, by hand — supplied the
 * value a product or variant field currently has, and the rules for when a provider may change
 * it.
 */

/** Product columns tracked by provenance (camelCase column → field name). */
export const PRODUCT_FIELDS = {
  name: "name",
  modelName: "model_name",
  modelNumber: "model_number",
  manufacturerPartNumber: "manufacturer_part_number",
  releaseDate: "release_date",
  announcedDate: "announced_date",
  discontinuedDate: "discontinued_date",
  description: "description",
  shortDescription: "short_description",
  productStatus: "product_status",
  familyId: "family",
} as const;

export const VARIANT_FIELDS = {
  variantName: "variant_name",
  manufacturerPartNumber: "manufacturer_part_number",
  regionCode: "region",
  color: "colour",
  memoryConfiguration: "memory",
  storageConfiguration: "storage",
  configurationLabel: "configuration_label",
  barcodeGtin: "gtin",
  sku: "sku",
} as const;

export const specField = (key: string) => `spec:${key}`;

export function valueHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

export type ProvenanceRow = {
  field: string;
  source_id: string | null;
  is_manual: boolean;
  confidence: number | null;
  is_current: boolean;
  value_hash: string;
};

/** Current provenance per field for one product (variantId null) or one variant. */
export async function currentProvenance(
  db: DbOrTx,
  productId: string,
  variantId: string | null,
): Promise<Map<string, ProvenanceRow>> {
  const rows = await db.execute<ProvenanceRow>(sql`
    SELECT field, source_id, is_manual, confidence::float AS confidence, is_current, value_hash
    FROM field_provenance
    WHERE product_id = ${productId} AND variant_id IS NOT DISTINCT FROM ${variantId} AND is_current`);
  return new Map(rows.map((r) => [r.field, r]));
}

/** Makes `sourceId` (or the manual entry) the current supplier of a field. */
export async function recordProvenance(
  db: DbOrTx,
  entry: {
    productId: string;
    variantId: string | null;
    field: string;
    value: unknown;
    rawValue?: unknown;
    retrievedAt: Date;
  } & (
    | {
        manual: true;
        adminUserId: string | null;
      }
    | {
        manual?: false;
        sourceId: string;
        provider: string;
        providerProductId: string;
        confidence: number;
        /** false = the source's value is recorded but another value stays current. */
        current?: boolean;
      }
  ),
): Promise<void> {
  const current = entry.manual ? true : (entry.current ?? true);
  if (current) {
    await db.execute(sql`
      UPDATE field_provenance SET is_current = false
      WHERE product_id = ${entry.productId} AND variant_id IS NOT DISTINCT FROM ${entry.variantId}
        AND field = ${entry.field} AND is_current`);
  }
  const raw = entry.rawValue === undefined ? entry.value : entry.rawValue;
  await db.execute(sql`
    INSERT INTO field_provenance
      (product_id, variant_id, field, source_id, is_manual, admin_user_id, provider, provider_product_id,
       raw_value, value_hash, retrieved_at, confidence, is_current)
    VALUES (${entry.productId}, ${entry.variantId}, ${entry.field},
      ${entry.manual ? null : entry.sourceId}, ${entry.manual === true},
      ${entry.manual ? entry.adminUserId : null},
      ${entry.manual ? null : entry.provider}, ${entry.manual ? null : entry.providerProductId},
      ${JSON.stringify(raw ?? null)}::jsonb, ${valueHash(entry.value)},
      ${entry.retrievedAt.toISOString()}::timestamptz,
      ${entry.manual ? 1 : entry.confidence}, ${current})
    ON CONFLICT ON CONSTRAINT field_provenance_uq DO UPDATE SET
      is_manual = EXCLUDED.is_manual, admin_user_id = EXCLUDED.admin_user_id,
      provider = EXCLUDED.provider, provider_product_id = EXCLUDED.provider_product_id,
      raw_value = EXCLUDED.raw_value, value_hash = EXCLUDED.value_hash,
      retrieved_at = EXCLUDED.retrieved_at, confidence = EXCLUDED.confidence,
      is_current = EXCLUDED.is_current`);
}

/** Records an admin's hand edit of product or variant columns (called by the services). */
export async function recordManualEdits(
  db: DbOrTx,
  target: { productId: string; variantId: string | null },
  fields: Record<string, string>,
  changes: Record<string, unknown>,
  adminUserId: string | null,
): Promise<void> {
  const now = new Date();
  for (const [column, value] of Object.entries(changes)) {
    const field = fields[column];
    if (!field) continue;
    await recordProvenance(db, {
      ...target,
      field,
      value,
      retrievedAt: now,
      manual: true,
      adminUserId,
    });
  }
}

export type FieldDecision =
  /** Write the provider value. */
  | "set"
  /** Same value: only refresh the provenance. */
  | "same"
  /** The provider has no value: keep ours (never clear a field because a source lacks it). */
  | "keep"
  /** Ours is protected (manual, verified, or from another source): queue a review item. */
  | "conflict"
  /** Another source supplied ours with higher confidence: keep it, record the provider's. */
  | "lower_confidence";

/**
 * Whether a provider may change a field. A value is protected when an admin edited it by hand,
 * when the product is verified or published (an editor vouched for it), or when it has no
 * provenance at all (entered before provenance existed — treated as manual).
 */
export function decideField(input: {
  current: unknown;
  incoming: unknown;
  provenance: ProvenanceRow | undefined;
  sourceId: string;
  confidence: number;
  productProtected: boolean;
}): FieldDecision {
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(input.incoming)) return "keep";
  if (empty(input.current)) return "set";
  if (valueHash(input.current) === valueHash(input.incoming)) return "same";
  const p = input.provenance;
  if (!p || p.is_manual || input.productProtected) return "conflict";
  if (p.source_id === input.sourceId) return "set";
  if ((p.confidence ?? 0) > input.confidence) return "lower_confidence";
  return "conflict";
}
