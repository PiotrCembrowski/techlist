import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import type { ProviderFeature, ProviderKey } from "@/modules/providers/core/types";
import { getEffectiveDefinitions } from "@/modules/specifications/service";
import { variantKeysFor } from "./catalog-config";
import {
  featureTransformSchema,
  type FeatureMapping,
  type MappedDefinition,
  type NormalizeContext,
} from "./normalize";

/** Feature mappings are looked up by provider ID, then by name with this prefix. */
export const NAME_MAPPING_PREFIX = "name:";

export function featureNameKey(name: string): string {
  return `${NAME_MAPPING_PREFIX}${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/** Our category for a provider category (provider_mappings, type category), or null. */
export async function mapCategory(
  db: DbOrTx,
  provider: ProviderKey,
  externalId: string | null,
): Promise<{ id: string; slug: string } | null> {
  if (!externalId) return null;
  const [row] = await db.execute<{ id: string; slug: string }>(sql`
    SELECT c.id, c.slug FROM provider_mappings m JOIN categories c ON c.id = m.target_category_id
    WHERE m.provider = ${provider} AND m.mapping_type = 'category' AND m.action = 'map'
      AND m.external_id = ${externalId} AND m.category_id IS NULL
    LIMIT 1`);
  return row ?? null;
}

/**
 * Builds the NormalizeContext for one provider and target category: feature mappings scoped to
 * the category win over global ones; only definitions that apply to the category (inheritance
 * included) can be targets.
 */
export async function loadNormalizeContext(
  db: DbOrTx,
  provider: ProviderKey,
  category: { id: string; slug: string } | null,
  confidence: number,
): Promise<NormalizeContext> {
  if (!category) {
    return { mapFeature: () => null, variantKeys: {}, confidence };
  }
  const defs = await getEffectiveDefinitions(db, category.id);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const rows = await db.execute<{
    external_id: string;
    category_id: string | null;
    target_definition_id: string | null;
    transform: unknown;
    action: "map" | "ignore";
  }>(sql`
    SELECT external_id, category_id, target_definition_id, transform, action FROM provider_mappings
    WHERE provider = ${provider} AND mapping_type = 'feature'
      AND (category_id IS NULL OR category_id = ${category.id})
    ORDER BY (category_id IS NULL)`); // category-specific rows first
  const mappings = new Map<string, FeatureMapping>();
  for (const r of rows) {
    if (mappings.has(r.external_id)) continue;
    if (r.action === "ignore") {
      mappings.set(r.external_id, { action: "ignore" });
      continue;
    }
    const def = r.target_definition_id ? byId.get(r.target_definition_id) : undefined;
    if (!def) continue; // maps to a definition of another category: not applicable here
    const transform = r.transform ? featureTransformSchema.safeParse(r.transform) : null;
    mappings.set(r.external_id, {
      action: "map",
      definition: def as MappedDefinition,
      transform: transform?.success ? transform.data : null,
    });
  }
  return {
    mapFeature: (f: ProviderFeature) =>
      mappings.get(f.externalId) ?? mappings.get(featureNameKey(f.name)) ?? null,
    variantKeys: variantKeysFor(category.slug),
    confidence,
  };
}
