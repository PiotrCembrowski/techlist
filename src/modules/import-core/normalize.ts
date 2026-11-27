import { z } from "zod";
import { partitionGtins } from "@/lib/gtin";
import { formatQuantity } from "@/lib/units";
import { ValidationError } from "@/modules/_shared/errors";
import type {
  ProviderFeature,
  ProviderImage,
  ProviderKey,
  ProviderRecord,
} from "@/modules/providers/core/types";
import {
  parseSpecificationValue,
  type DefinitionShape,
  type RawSpecValue,
  type SpecValueColumns,
} from "@/modules/specifications/parse";
import {
  brandKey,
  modelKey,
  nameKey,
  normalizeIsoDate,
  normalizeMpn,
  normalizeText,
  plainText,
} from "./identity";

/**
 * The unified product model (DECISIONS D79): what one provider record says about one product,
 * normalised for matching and storage, with every original value kept next to its normalised
 * form. Nothing is inferred: a value the provider did not give stays null.
 */

/** A normalised value and exactly what the provider sent. */
export interface Normalized<T> {
  value: T | null;
  raw: string | null;
}

export interface NormalizedSpec {
  key: string;
  definitionId: string;
  /** Passed to setSpecificationValue (parsed again there, against the same definition). */
  input: RawSpecValue;
  /** Parsed columns, for comparing with stored values. */
  columns: SpecValueColumns;
  rawValue: string;
  rawUnit: string | null;
  externalId: string;
}

export interface RejectedFeature {
  feature: ProviderFeature;
  key: string;
  reason: string;
}

export interface NormalizedProduct {
  provider: ProviderKey;
  providerProductId: string;
  sourceUrl: string | null;
  brand: Normalized<string> & { key: string | null };
  name: Normalized<string> & { key: string | null };
  modelNumber: Normalized<string> & { key: string | null };
  mpn: Normalized<string>;
  gtins: string[];
  invalidGtins: { raw: string; reason: string }[];
  category: { externalId: string | null; name: string | null };
  family: Normalized<string>;
  description: Normalized<string>;
  releaseDate: Normalized<string>;
  /** Purchasable-configuration attributes; only from explicit provider values. */
  variant: {
    storage: string | null;
    memory: string | null;
    colour: Normalized<string>;
    region: Normalized<string>;
    revision: Normalized<string>;
  };
  specs: NormalizedSpec[];
  unmappedFeatures: ProviderFeature[];
  rejectedFeatures: RejectedFeature[];
  images: ProviderImage[];
  quality: string | null;
  retrievedAt: Date;
  payloadHash: string;
  /** 0–1, from the adapter (e.g. editor-checked records rank higher than supplier ones). */
  confidence: number;
  /** Problems that do not stop the record but a reviewer should see. */
  issues: string[];
}

/** Optional per-mapping rules (provider_mappings.transform). */
export const featureTransformSchema = z
  .object({
    /** Unit to assume when the provider gives a bare number (only when its docs say so). */
    unit: z.string().min(1).max(20).optional(),
    /** Provider value → our value (case-insensitive keys), e.g. { "Y": "yes" }. */
    valueMap: z.record(z.string(), z.string()).optional(),
    /** Separator for multi-select values; default "," and ";". */
    split: z.string().min(1).max(3).optional(),
  })
  .strict();
export type FeatureTransform = z.infer<typeof featureTransformSchema>;

export interface MappedDefinition extends DefinitionShape {
  id: string;
}

export type FeatureMapping =
  | { action: "map"; definition: MappedDefinition; transform: FeatureTransform | null }
  | { action: "ignore" };

/** Everything normalisation needs to know about our catalogue, loaded beforehand (./mappings). */
export interface NormalizeContext {
  /** Looks a feature up by provider ID first, then by name. */
  mapFeature(feature: ProviderFeature): FeatureMapping | null;
  /** Spec keys that define variants in the target category (e.g. storage, memory). */
  variantKeys: { storage?: string; memory?: string };
  /** Adapter-specific confidence for this record. */
  confidence: number;
}

const BARE_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

function prepareInput(
  def: MappedDefinition,
  feature: ProviderFeature,
  transform: FeatureTransform | null,
): RawSpecValue {
  let value = feature.value.trim();
  if (transform?.valueMap) {
    const hit = Object.entries(transform.valueMap).find(
      ([k]) => k.toLowerCase() === value.toLowerCase(),
    );
    if (hit) value = hit[1];
  }
  if (def.dataType === "multi_select") {
    const sep = transform?.split;
    return (sep ? value.split(sep) : value.split(/[,;]/)).map((s) => s.trim()).filter(Boolean);
  }
  if ((def.dataType === "integer" || def.dataType === "decimal") && def.canonicalUnit) {
    const unit = feature.unit?.trim() || transform?.unit;
    if (BARE_NUMBER.test(value)) {
      // A bare number is converted only when the unit is known; never assumed.
      if (!unit) throw new ValidationError(`${def.name}: no unit given for "${value}"`);
      return `${value} ${unit}`;
    }
    return feature.unit && !value.toLowerCase().includes(feature.unit.toLowerCase())
      ? `${value} ${feature.unit}`
      : value;
  }
  return value;
}

function displayValue(def: MappedDefinition, columns: SpecValueColumns): string | null {
  if (columns.valueNumeric === null) return null;
  return def.canonicalUnit
    ? formatQuantity(columns.valueNumeric, def.canonicalUnit)
    : String(columns.valueNumeric);
}

/** Maps and parses features. Unmapped ones are kept raw; unparseable ones are reported. */
export function normalizeFeatures(features: readonly ProviderFeature[], ctx: NormalizeContext) {
  const specs: NormalizedSpec[] = [];
  const unmapped: ProviderFeature[] = [];
  const rejected: RejectedFeature[] = [];
  const display = new Map<string, string | null>();
  for (const feature of features) {
    if (!feature.value?.trim()) continue;
    const mapping = ctx.mapFeature(feature);
    if (!mapping) {
      unmapped.push(feature);
      continue;
    }
    if (mapping.action === "ignore") continue;
    const def = mapping.definition;
    if (specs.some((s) => s.key === def.key)) {
      rejected.push({
        feature,
        key: def.key,
        reason: "another feature already supplied this value",
      });
      continue;
    }
    try {
      const input = prepareInput(def, feature, mapping.transform);
      const columns = parseSpecificationValue(def, input);
      specs.push({
        key: def.key,
        definitionId: def.id,
        input,
        columns,
        rawValue: feature.value,
        rawUnit: feature.unit,
        externalId: feature.externalId,
      });
      display.set(def.key, displayValue(def, columns));
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      rejected.push({ feature, key: def.key, reason: e.message });
    }
  }
  return { specs, unmapped, rejected, display };
}

const norm = (raw: string | null | undefined, maxLength?: number): Normalized<string> => ({
  value: normalizeText(raw, maxLength),
  raw: raw ?? null,
});

/** ProviderRecord → NormalizedProduct. Pure; the context carries the catalogue's mappings. */
export function normalizeRecord(record: ProviderRecord, ctx: NormalizeContext): NormalizedProduct {
  const issues: string[] = [];
  const { valid: gtins, invalid: invalidGtins } = partitionGtins(record.gtins);
  for (const g of invalidGtins)
    issues.push(`GTIN ${g.raw} rejected (${g.reason.replace(/_/g, " ")})`);

  const brand = norm(record.brand, 120);
  const name = norm(record.name, 200);
  const model = norm(record.modelNumber, 80);
  const mpnValue = normalizeMpn(record.mpn);
  if (record.mpn && !mpnValue) issues.push(`MPN "${record.mpn}" rejected`);
  const releaseDate = normalizeIsoDate(record.releaseDate);
  if (record.releaseDate && !releaseDate)
    issues.push(`Release date "${record.releaseDate}" is not a full date; not stored`);

  const { specs, unmapped, rejected, display } = normalizeFeatures(record.features, ctx);
  const images = record.images.filter((img) => {
    const ok = /^https:\/\//i.test(img.url);
    if (!ok) issues.push(`Image ${img.url} skipped (not https)`);
    return ok;
  });
  if (!brand.value) issues.push("No brand");
  if (!name.value) issues.push("No product name");

  return {
    provider: record.provider,
    providerProductId: record.providerProductId,
    sourceUrl: record.url,
    brand: { ...brand, key: brandKey(record.brand) },
    name: { ...name, key: nameKey(record.name, record.brand) },
    modelNumber: { ...model, key: modelKey(record.modelNumber) },
    mpn: { value: mpnValue, raw: record.mpn },
    gtins,
    invalidGtins,
    category: { externalId: record.categoryExternalId, name: record.categoryName },
    family: norm(record.family ?? null, 120),
    description: { value: plainText(record.description), raw: record.description },
    releaseDate: { value: releaseDate, raw: record.releaseDate },
    variant: {
      storage: ctx.variantKeys.storage ? (display.get(ctx.variantKeys.storage) ?? null) : null,
      memory: ctx.variantKeys.memory ? (display.get(ctx.variantKeys.memory) ?? null) : null,
      colour: norm(record.variant?.colour ?? null, 80),
      region: {
        value: /^[A-Z]{2}$/.test(record.variant?.region?.trim().toUpperCase() ?? "")
          ? record.variant!.region!.trim().toUpperCase()
          : null,
        raw: record.variant?.region ?? null,
      },
      revision: norm(record.variant?.revision ?? null, 80),
    },
    specs,
    unmappedFeatures: unmapped,
    rejectedFeatures: rejected,
    images,
    quality: record.quality,
    retrievedAt: record.retrievedAt,
    payloadHash: record.payloadHash,
    confidence: ctx.confidence,
    issues,
  };
}
