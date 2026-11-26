import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { findMatch, resolveBrand, type MatchCandidate } from "@/modules/import-core/match";
import { loadNormalizeContext, mapCategory } from "@/modules/import-core/mappings";
import { normalizeRecord } from "@/modules/import-core/normalize";
import type { ProviderAdapter, ProviderRecord } from "@/modules/providers/core/types";

/** What the Import Center shows for one record before anything is imported. */
export interface RecordPreview {
  providerProductId: string;
  name: string | null;
  brand: string | null;
  brandFound: boolean;
  modelNumber: string | null;
  mpn: string | null;
  gtins: string[];
  category: { externalId: string | null; name: string | null; mappedTo: string | null };
  specs: { key: string; value: string }[];
  unmappedFeatures: number;
  rejectedFeatures: string[];
  images: number;
  /** Core (required) specifications of the category this record does not supply. */
  missing: string[];
  licenceWarnings: string[];
  match:
    | { kind: "new" }
    | { kind: "existing"; productId: string; rule: string; reason: string }
    | { kind: "review"; reason: string; candidates: MatchCandidate[] };
  /** Can be imported as is (brand and category known; duplicates only need review). */
  eligible: boolean;
  issues: string[];
}

function display(columns: Record<string, unknown>): string {
  const v =
    columns.valueText ??
    columns.valueNumeric ??
    columns.valueBoolean ??
    columns.valueDate ??
    columns.valueJson;
  return Array.isArray(v) ? v.join(", ") : String(v);
}

/** Normalises and matches one record read-only (no catalogue writes). */
export async function previewRecord(
  db: DbOrTx,
  adapter: ProviderAdapter,
  record: ProviderRecord,
): Promise<RecordPreview> {
  const category = await mapCategory(db, record.provider, record.categoryExternalId);
  const ctx = await loadNormalizeContext(
    db,
    record.provider,
    category,
    adapter.recordConfidence?.(record) ?? 0.7,
  );
  const p = normalizeRecord(record, ctx);
  const brand = await resolveBrand(db, p.provider, p.brand.value);
  const issues = [...p.issues];
  if (brand.kind === "unknown") issues.push(`Unknown brand "${p.brand.value ?? ""}"`);
  if (brand.kind === "ambiguous")
    issues.push(`Brand "${p.brand.value ?? ""}" matches several brands`);
  if (!category)
    issues.push(`No category mapping for "${p.category.name ?? p.category.externalId ?? ""}"`);

  let match: RecordPreview["match"] = { kind: "new" };
  if (brand.kind === "found") {
    const m = await findMatch(db, p, { id: brand.brandId, name: brand.name });
    if (m.kind === "match")
      match = { kind: "existing", productId: m.productId, rule: m.rule, reason: m.reason };
    else if (m.kind === "conflict")
      match = { kind: "review", reason: m.reason, candidates: m.candidates };
    else if (m.kind === "suggestions")
      match = { kind: "review", reason: "Similar products exist", candidates: m.candidates };
  }

  let missing: string[] = [];
  if (category) {
    const required = await db.execute<{ key: string; name: string }>(sql`
      WITH RECURSIVE chain(id, parent_id) AS (
        SELECT id, parent_id FROM categories WHERE id = ${category.id}
        UNION ALL SELECT c.id, c.parent_id FROM categories c JOIN chain ON c.id = chain.parent_id)
      SELECT d.key, d.name FROM specification_definitions d WHERE d.category_id IN (SELECT id FROM chain) AND d.is_required`);
    const have = new Set(p.specs.map((s) => s.key));
    missing = required.filter((r) => !have.has(r.key)).map((r) => r.name);
  }

  const licenceWarnings: string[] = [];
  if (adapter.licence.unverified)
    licenceWarnings.push("Licence terms not yet checked against the provider's documentation");
  if (adapter.licence.usage !== "store")
    licenceWarnings.push("Cross-check only: values cannot be stored");
  if (adapter.licence.attributionRequired)
    licenceWarnings.push(`Attribution required: ${adapter.licence.attribution ?? "see licence"}`);
  if (p.images.length) licenceWarnings.push("Images need a rights review before they are shown");

  return {
    providerProductId: p.providerProductId,
    name: p.name.value,
    brand: p.brand.value,
    brandFound: brand.kind === "found",
    modelNumber: p.modelNumber.value,
    mpn: p.mpn.value,
    gtins: p.gtins,
    category: {
      externalId: p.category.externalId,
      name: p.category.name,
      mappedTo: category?.slug ?? null,
    },
    specs: p.specs.map((s) => ({
      key: s.key,
      value: display(s.columns as unknown as Record<string, unknown>),
    })),
    unmappedFeatures: p.unmappedFeatures.length,
    rejectedFeatures: p.rejectedFeatures.map((r) => `${r.feature.name}: ${r.reason}`),
    images: p.images.length,
    missing,
    licenceWarnings,
    match,
    eligible: brand.kind === "found" && Boolean(category) && Boolean(p.name.value),
    issues,
  };
}
