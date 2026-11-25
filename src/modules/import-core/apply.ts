import { and, eq, isNull, sql } from "drizzle-orm";
import {
  productImages,
  products,
  productSourceRecords,
  productSpecifications,
  productVariants,
  reviewItems,
} from "@/db/schema";
import { displayGtin } from "@/lib/gtin";
import { slugify } from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext, type Tx } from "@/modules/_shared/context";
import { InvalidStateError } from "@/modules/_shared/errors";
import { createProduct, updateProduct, type Product } from "@/modules/products/service";
import type { ProviderKey, ProviderLicence, ProviderRecord } from "@/modules/providers/core/types";
import { createReviewItem } from "@/modules/review-queue/service";
import { setSpecificationValue } from "@/modules/specifications/service";
import { createProductVariant, updateProductVariant } from "@/modules/variants/service";
import { variantKeysFor } from "./catalog-config";
import { normalizeText } from "./identity";
import {
  findMatch,
  identifyVariant,
  resolveBrand,
  type MatchCandidate,
  type MatchResult,
} from "./match";
import type { NormalizedProduct, NormalizedSpec } from "./normalize";
import {
  currentProvenance,
  decideField,
  recordProvenance,
  specField,
  valueHash,
  type FieldDecision,
} from "./provenance";

/**
 * Applies one normalised provider record to the catalogue (DECISIONS D79), in one transaction:
 * - imports create only `needs_review` products and variants; nothing is published here;
 * - identifiers decide; similar names only ever produce review suggestions;
 * - a value an admin edited, verified, or that came from a more confident source is never
 *   overwritten: a review item is queued instead (fields: field_conflict, specs: conflicting_value);
 * - every applied value records field provenance; one audit entry summarises the import;
 * - re-running with the same payload changes nothing; concurrent runs for the same provider record
 *   are serialised by an advisory lock, and unique constraints catch the rest.
 */

export interface ImportSource {
  id: string;
  provider: ProviderKey;
  licence: ProviderLicence;
}

export type ImportDecision =
  | { mode: "auto" }
  /** Reviewer: keep separate — create a new product. */
  | { mode: "new" }
  /** Reviewer: same product (optionally a specific variant) — apply the record to it. */
  | { mode: "merge"; productId: string; variantId?: string | null }
  /** Reviewer: a new configuration of an existing product. */
  | { mode: "variant"; productId: string };

export type ImportStatus =
  "created" | "updated" | "unchanged" | "needs_review" | "blocked" | "skipped";

export interface ImportOutcome {
  status: ImportStatus;
  productId: string | null;
  variantId: string | null;
  reviewItemIds: string[];
  /** Field-level summary for the job report and the audit entry. */
  changes: { field: string; decision: FieldDecision | "created" }[];
  notes: string[];
}

export interface ImportInput {
  product: NormalizedProduct;
  source: ImportSource;
  category: { id: string; slug: string } | null;
  /** The provider record as received, stored on the source record (size-capped). */
  raw?: ProviderRecord;
  decision?: ImportDecision;
}

const MAX_IMAGES = 10;
const MAX_RAW_CHARS = 200_000;

function outcome(status: ImportStatus, extra: Partial<ImportOutcome> = {}): ImportOutcome {
  return {
    status,
    productId: null,
    variantId: null,
    reviewItemIds: [],
    changes: [],
    notes: [],
    ...extra,
  };
}

/** JSON-safe copy of a normalised product (stored in review payloads; Dates as ISO strings). */
export function serializeProduct(p: NormalizedProduct): Record<string, unknown> {
  return JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
}

export function deserializeProduct(v: unknown): NormalizedProduct {
  const p = v as NormalizedProduct & { retrievedAt: string | Date };
  return { ...p, retrievedAt: new Date(p.retrievedAt) };
}

/** Product name without a leading brand ("Samsung Galaxy S24" → "Galaxy S24"); pages add the brand. */
export function productDisplayName(name: string, brandName: string): string {
  const prefix = `${brandName.toLowerCase()} `;
  return name.toLowerCase().startsWith(prefix) && name.length > prefix.length
    ? name.slice(prefix.length).trim()
    : name;
}

async function availableSlug(tx: Tx, base: string, brandSlug: string): Promise<string> {
  const candidates = [base, `${base}-${brandSlug}`].filter(Boolean);
  for (let i = 2; candidates.length < 12; i++) candidates.push(`${base}-${brandSlug}-${i}`);
  for (const c of candidates) {
    const s = c.replace(/-vs-/g, "-").slice(0, 120).replace(/-+$/, "");
    const [hit] = await tx.select({ id: products.id }).from(products).where(eq(products.slug, s));
    if (!hit) return s;
  }
  throw new InvalidStateError("Could not find a free slug for the product");
}

function variantLabel(p: NormalizedProduct): string | null {
  const parts = [
    p.variant.storage,
    p.variant.memory ? `${p.variant.memory} RAM` : null,
    p.variant.colour.value,
    p.variant.region.value,
    p.variant.revision.value,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const hasVariantAttributes = (p: NormalizedProduct) => variantLabel(p) !== null;

async function openReviewItem(tx: Tx, type: string, match: Record<string, string>) {
  const conds = Object.entries(match).map(([k, v]) => sql`${reviewItems.payload}->>${k} = ${v}`);
  const [row] = await tx
    .select({ id: reviewItems.id })
    .from(reviewItems)
    .where(and(sql`${reviewItems.itemType} = ${type}`, eq(reviewItems.status, "open"), ...conds))
    .limit(1);
  return row?.id ?? null;
}

/** Imports one record. Throws only for programming/licence errors; data problems are outcomes. */
export async function importNormalizedProduct(
  ctx: ServiceContext,
  input: ImportInput,
): Promise<ImportOutcome> {
  const { product: p, source } = input;
  if (source.licence.usage !== "store")
    throw new InvalidStateError(
      `${source.provider} data may only be used to cross-check, not stored in the catalogue`,
    );
  return inTransaction(ctx, async (tx) => {
    const sctx: ServiceContext = { db: tx, actorId: ctx.actorId };
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`import:${p.provider}:${p.providerProductId}`}))`,
    );
    const decision = input.decision ?? { mode: "auto" };

    if (!p.name.value) return outcome("blocked", { notes: ["The record has no product name"] });
    if (!input.category)
      return outcome("blocked", {
        notes: [
          `No category mapping for ${p.provider} category ${p.category.name ?? p.category.externalId ?? "(none)"}`,
        ],
      });
    const brand = await resolveBrand(tx, p.provider, p.brand.value);
    if (brand.kind !== "found")
      return outcome("blocked", {
        notes: [
          brand.kind === "unknown"
            ? `Unknown brand "${p.brand.value ?? ""}": create it or add a brand mapping`
            : `Brand "${p.brand.value ?? ""}" matches several brands; add a brand mapping`,
        ],
      });

    // Unchanged payload: only note that the provider still lists it.
    if (decision.mode === "auto") {
      const [existing] = await tx
        .select()
        .from(productSourceRecords)
        .where(
          and(
            eq(productSourceRecords.sourceId, source.id),
            eq(productSourceRecords.providerProductId, p.providerProductId),
          ),
        );
      if (existing && existing.payloadHash === p.payloadHash) {
        await tx
          .update(productSourceRecords)
          .set({ lastSeenAt: p.retrievedAt })
          .where(eq(productSourceRecords.id, existing.id));
        return outcome("unchanged", {
          productId: existing.productId,
          variantId: existing.variantId,
        });
      }
    }

    let match: MatchResult;
    if (decision.mode === "new") match = { kind: "new" };
    else if (decision.mode === "merge" || decision.mode === "variant")
      match = {
        kind: "match",
        productId: decision.productId,
        variantId: decision.mode === "merge" ? (decision.variantId ?? null) : null,
        rule: "name",
        reason: "reviewer decision",
      };
    else match = await findMatch(tx, p, { id: brand.brandId, name: brand.name });

    if (match.kind === "conflict" || match.kind === "suggestions") {
      return queueDuplicateReview(
        tx,
        sctx,
        input,
        match.candidates,
        match.kind === "conflict" ? match.reason : "Similar products exist; nothing was merged",
      );
    }

    if (match.kind === "new") {
      return createFromRecord(tx, sctx, input, { id: brand.brandId, name: brand.name });
    }

    const [target] = await tx.select().from(products).where(eq(products.id, match.productId));
    if (!target) throw new InvalidStateError("The matched product no longer exists");
    if (target.brandId !== brand.brandId)
      return queueDuplicateReview(
        tx,
        sctx,
        input,
        [],
        "The matched product belongs to another brand",
      );
    if (target.status === "rejected" || target.status === "archived")
      return outcome("skipped", {
        productId: target.id,
        notes: [`Matched a ${target.status} product (${match.reason}); not updated`],
      });
    return updateFromRecord(tx, sctx, input, target, match.variantId, decision.mode === "variant");
  });
}

async function queueDuplicateReview(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  candidates: MatchCandidate[],
  reason: string,
): Promise<ImportOutcome> {
  const p = input.product;
  const existing = await openReviewItem(tx, "duplicate_candidate", {
    kind: "provider",
    provider: p.provider,
    providerProductId: p.providerProductId,
  });
  if (existing) return outcome("needs_review", { reviewItemIds: [existing], notes: [reason] });
  const item = await createReviewItem(tx, {
    itemType: "duplicate_candidate",
    entityType: "provider_record",
    entityId: null,
    createdBy: ctx.actorId,
    payload: {
      kind: "provider",
      provider: p.provider,
      providerProductId: p.providerProductId,
      reason,
      candidates,
      source: input.source,
      category: input.category,
      product: serializeProduct(p),
    },
  });
  return outcome("needs_review", { reviewItemIds: [item.id], notes: [reason] });
}

// ─── Create ────────────────────────────────────────────────────────────────────────────

async function createFromRecord(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  brand: { id: string; name: string },
): Promise<ImportOutcome> {
  const p = input.product;
  const res = outcome("created");
  const name = productDisplayName(p.name.value!, brand.name);
  const [brandRow] = await tx.execute<{ slug: string }>(
    sql`SELECT slug FROM brands WHERE id = ${brand.id}`,
  );
  const slug = await availableSlug(tx, slugify(name), brandRow!.slug);
  const productMpn = hasVariantAttributes(p) ? null : p.mpn.value;
  const created = await createProduct(
    ctx,
    {
      brandId: brand.id,
      categoryId: input.category!.id,
      name,
      slug,
      modelNumber: p.modelNumber.value,
      manufacturerPartNumber: productMpn,
      releaseDate: p.releaseDate.value,
      description: p.description.value,
      isDemo: false,
    },
    { status: "needs_review" },
  );
  res.productId = created.id;
  const fields: [string, unknown, unknown][] = [
    ["name", name, p.name.raw],
    ["model_number", p.modelNumber.value, p.modelNumber.raw],
    ["manufacturer_part_number", productMpn, p.mpn.raw],
    ["release_date", p.releaseDate.value, p.releaseDate.raw],
    ["description", p.description.value, p.description.raw],
  ];
  for (const [field, value, raw] of fields) {
    if (value === null || value === undefined) continue;
    await providerProvenance(tx, input, created.id, null, field, value, raw, true);
    res.changes.push({ field, decision: "created" });
  }
  const item = await createReviewItem(tx, {
    itemType: "new_product",
    entityType: "product",
    entityId: created.id,
    createdBy: ctx.actorId,
    payload: { productId: created.id, name, source: "provider", provider: p.provider },
  });
  res.reviewItemIds.push(item.id);

  if (hasVariantAttributes(p)) {
    res.variantId = await createVariantFromRecord(tx, ctx, input, created.id, res);
  }
  await finishRecord(tx, ctx, input, created, res.variantId, res, { isNew: true });
  return res;
}

async function createVariantFromRecord(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  productId: string,
  res: ImportOutcome,
): Promise<string> {
  const p = input.product;
  const label = variantLabel(p) ?? "Standard";
  let gtin = p.gtins[0] ? displayGtin(p.gtins[0]) : null;
  if (gtin) {
    // A GTIN identifies one trade item: never give it to a second variant.
    const [taken] = await tx.execute(sql`
      SELECT 1 FROM product_variants WHERE barcode_gtin IS NOT NULL AND lpad(barcode_gtin, 14, '0') = ${p.gtins[0]!}`);
    if (taken) {
      res.notes.push(`GTIN ${gtin} is already used by another variant; the new variant has none`);
      gtin = null;
    }
  }
  const variant = await createProductVariant(ctx, productId, {
    variantName: label.slice(0, 200),
    variantCode: slugify(label).slice(0, 64) || undefined,
    storageConfiguration: p.variant.storage,
    memoryConfiguration: p.variant.memory,
    color: p.variant.colour.value,
    regionCode: p.variant.region.value,
    barcodeGtin: gtin,
    manufacturerPartNumber: p.mpn.value,
    status: "needs_review",
  });
  const vf: [string, unknown, unknown][] = [
    ["storage", p.variant.storage, null],
    ["memory", p.variant.memory, null],
    ["colour", p.variant.colour.value, p.variant.colour.raw],
    ["region", p.variant.region.value, p.variant.region.raw],
    ["gtin", gtin, p.gtins[0] ?? null],
    ["manufacturer_part_number", p.mpn.value, p.mpn.raw],
  ];
  for (const [field, value, raw] of vf) {
    if (value === null || value === undefined) continue;
    await providerProvenance(tx, input, productId, variant.id, field, value, raw ?? value, true);
    res.changes.push({ field: `variant.${field}`, decision: "created" });
  }
  return variant.id;
}

// ─── Update ────────────────────────────────────────────────────────────────────────────

async function updateFromRecord(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  target: Product,
  matchedVariantId: string | null,
  forceNewVariant: boolean,
): Promise<ImportOutcome> {
  const p = input.product;
  const res = outcome("unchanged", { productId: target.id });

  // Decide the variant before writing anything.
  let variantId: string | null = matchedVariantId;
  let createVariant = false;
  if (forceNewVariant) createVariant = true;
  else if (!variantId) {
    const v = await identifyVariant(tx, target.id, p);
    if (v.kind === "existing") variantId = v.variantId;
    else if (v.kind === "new") createVariant = true;
    else if (v.kind === "ambiguous") {
      const existing = await openReviewItem(tx, "variant_ambiguity", {
        kind: "provider",
        provider: p.provider,
        providerProductId: p.providerProductId,
      });
      const id =
        existing ??
        (
          await createReviewItem(tx, {
            itemType: "variant_ambiguity",
            entityType: "product",
            entityId: target.id,
            createdBy: ctx.actorId,
            payload: {
              kind: "provider",
              provider: p.provider,
              providerProductId: p.providerProductId,
              productId: target.id,
              variantIds: v.variantIds,
              reason: v.reason,
              source: input.source,
              category: input.category,
              product: serializeProduct(p),
            },
          })
        ).id;
      return outcome("needs_review", {
        productId: target.id,
        reviewItemIds: [id],
        notes: [v.reason],
      });
    }
  }

  const productProtected = target.status === "verified" || target.status === "published";
  const prov = await currentProvenance(tx, target.id, null);
  const productMpn = hasVariantAttributes(p) ? null : p.mpn.value;
  const candidates: [keyof Product, string, unknown, unknown][] = [
    [
      "name",
      "name",
      p.name.value ? productDisplayName(p.name.value, await brandName(tx, target.brandId)) : null,
      p.name.raw,
    ],
    ["modelNumber", "model_number", p.modelNumber.value, p.modelNumber.raw],
    ["manufacturerPartNumber", "manufacturer_part_number", productMpn, p.mpn.raw],
    ["releaseDate", "release_date", p.releaseDate.value, p.releaseDate.raw],
    ["description", "description", p.description.value, p.description.raw],
  ];
  const patch: Record<string, unknown> = {};
  for (const [column, field, value, raw] of candidates) {
    const d = decideField({
      current: target[column],
      incoming: value,
      provenance: prov.get(field),
      sourceId: input.source.id,
      confidence: p.confidence,
      productProtected,
    });
    await handleFieldDecision(tx, ctx, input, res, {
      productId: target.id,
      variantId: null,
      column,
      field,
      current: target[column],
      value,
      raw,
      decision: d,
    });
    if (d === "set") patch[column] = value;
  }
  if (Object.keys(patch).length) {
    await updateProduct(ctx, target.id, patch, { provenance: "none" });
    res.status = "updated";
  }

  if (createVariant) {
    variantId = await createVariantFromRecord(tx, ctx, input, target.id, res);
    res.status = "updated";
  } else if (variantId) {
    await updateVariantFromRecord(tx, ctx, input, res, target.id, variantId, productProtected);
  }
  res.variantId = variantId;
  await finishRecord(tx, ctx, input, target, variantId, res, { isNew: false });
  return res;
}

async function brandName(tx: Tx, brandId: string): Promise<string> {
  const [b] = await tx.execute<{ name: string }>(
    sql`SELECT name FROM brands WHERE id = ${brandId}`,
  );
  return b?.name ?? "";
}

async function updateVariantFromRecord(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  res: ImportOutcome,
  productId: string,
  variantId: string,
  productProtected: boolean,
) {
  const p = input.product;
  const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId));
  if (!v) return;
  const prov = await currentProvenance(tx, productId, variantId);
  const vProtected = productProtected || v.status === "verified" || v.status === "published";
  const gtin = p.gtins[0] ? displayGtin(p.gtins[0]) : null;
  const candidates: [keyof typeof v, string, unknown, unknown][] = [
    ["storageConfiguration", "storage", p.variant.storage, null],
    ["memoryConfiguration", "memory", p.variant.memory, null],
    ["color", "colour", p.variant.colour.value, p.variant.colour.raw],
    ["regionCode", "region", p.variant.region.value, p.variant.region.raw],
    ["barcodeGtin", "gtin", gtin, p.gtins[0] ?? null],
    ["manufacturerPartNumber", "manufacturer_part_number", p.mpn.value, p.mpn.raw],
  ];
  const patch: Record<string, unknown> = {};
  for (const [column, field, value, raw] of candidates) {
    // A different GTIN means a different trade item: never replace it, only fill a missing one.
    const current = v[column];
    let d = decideField({
      current,
      incoming: value,
      provenance: prov.get(field),
      sourceId: input.source.id,
      confidence: p.confidence,
      productProtected: vProtected,
    });
    if (field === "gtin" && d === "set" && current) d = "conflict";
    await handleFieldDecision(tx, ctx, input, res, {
      productId,
      variantId,
      column,
      field,
      current,
      value,
      raw,
      decision: d,
    });
    if (d === "set") patch[column] = value;
  }
  if (Object.keys(patch).length) {
    await updateProductVariant(ctx, variantId, patch, { provenance: "none" });
    res.status = "updated";
  }
}

async function handleFieldDecision(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  res: ImportOutcome,
  f: {
    productId: string;
    variantId: string | null;
    column: string;
    field: string;
    current: unknown;
    value: unknown;
    raw: unknown;
    decision: FieldDecision;
  },
) {
  const p = input.product;
  const label = f.variantId ? `variant.${f.field}` : f.field;
  switch (f.decision) {
    case "keep":
      return;
    case "set":
      await providerProvenance(tx, input, f.productId, f.variantId, f.field, f.value, f.raw, true);
      res.changes.push({ field: label, decision: "set" });
      return;
    case "same":
    case "lower_confidence": {
      const prov = await currentProvenance(tx, f.productId, f.variantId);
      const owner = prov.get(f.field);
      // Same value with no owner yet, or our own: this source becomes (or stays) current.
      const current = f.decision === "same" && (!owner || owner.source_id === input.source.id);
      await providerProvenance(
        tx,
        input,
        f.productId,
        f.variantId,
        f.field,
        f.value,
        f.raw,
        current,
      );
      if (f.decision === "lower_confidence")
        res.changes.push({ field: label, decision: f.decision });
      return;
    }
    case "conflict": {
      await providerProvenance(tx, input, f.productId, f.variantId, f.field, f.value, f.raw, false);
      res.changes.push({ field: label, decision: "conflict" });
      const proposed = f.value instanceof Date ? f.value.toISOString().slice(0, 10) : f.value;
      const existing = await openReviewItem(tx, "field_conflict", {
        productId: f.productId,
        field: f.column,
        proposedHash: valueHash(proposed),
      });
      if (existing) {
        res.reviewItemIds.push(existing);
        return;
      }
      const item = await createReviewItem(tx, {
        itemType: "field_conflict",
        entityType: f.variantId ? "product_variant" : "product",
        entityId: f.variantId ?? f.productId,
        createdBy: ctx.actorId,
        payload: {
          productId: f.productId,
          variantId: f.variantId,
          field: f.column,
          current: f.current instanceof Date ? f.current.toISOString().slice(0, 10) : f.current,
          proposed,
          proposedHash: valueHash(proposed),
          sourceId: input.source.id,
          provider: p.provider,
          providerProductId: p.providerProductId,
        },
      });
      res.reviewItemIds.push(item.id);
      if (res.status === "unchanged") res.status = "needs_review";
    }
  }
}

function providerProvenance(
  tx: Tx,
  input: ImportInput,
  productId: string,
  variantId: string | null,
  field: string,
  value: unknown,
  raw: unknown,
  current: boolean,
) {
  return recordProvenance(tx, {
    productId,
    variantId,
    field,
    value,
    rawValue: raw,
    retrievedAt: input.product.retrievedAt,
    sourceId: input.source.id,
    provider: input.product.provider,
    providerProductId: input.product.providerProductId,
    confidence: input.product.confidence,
    current,
  });
}

// ─── Shared tail: identifiers, specs, images, source record, audit ─────────────────────

async function finishRecord(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  product: Product,
  variantId: string | null,
  res: ImportOutcome,
  opts: { isNew: boolean },
) {
  const p = input.product;
  await addIdentifiers(tx, input, product.id, variantId, res);
  await writeSpecs(tx, ctx, input, product, variantId, res);
  await addImages(tx, ctx, input, product, res);
  await upsertSourceRecord(tx, input, product.id, variantId, res);
  if (res.status === "unchanged" && res.changes.some((c) => c.decision === "conflict"))
    res.status = "needs_review";
  await recordAudit(tx, {
    actorId: ctx.actorId,
    entityType: "product",
    entityId: product.id,
    action: `import:${p.provider}`,
    next: {
      provider: p.provider,
      providerProductId: p.providerProductId,
      sourceId: input.source.id,
      outcome: res.status,
      created: opts.isNew,
      variantId,
      changes: res.changes,
      reviewItemIds: res.reviewItemIds,
    },
  });
}

async function addIdentifiers(
  tx: Tx,
  input: ImportInput,
  productId: string,
  variantId: string | null,
  res: ImportOutcome,
) {
  const p = input.product;
  const rows: {
    type: string;
    value: string;
    raw: string | null;
    provider: string | null;
    variant: string | null;
  }[] = [
    {
      type: "provider_product_id",
      value: p.providerProductId,
      raw: p.providerProductId,
      provider: p.provider,
      variant: variantId,
    },
    ...p.gtins.map((g) => ({ type: "gtin", value: g, raw: g, provider: null, variant: variantId })),
  ];
  if (p.mpn.value)
    rows.push({
      type: "mpn",
      value: p.mpn.value,
      raw: p.mpn.raw,
      provider: null,
      variant: variantId,
    });
  if (p.modelNumber.key)
    rows.push({
      type: "model_number",
      value: p.modelNumber.key,
      raw: p.modelNumber.raw,
      provider: null,
      variant: null,
    });
  for (const r of rows) {
    const inserted = await tx.execute(sql`
      INSERT INTO product_identifiers (product_id, variant_id, identifier_type, value, raw_value, provider, source_id)
      VALUES (${productId}, ${r.variant}, ${r.type}::identifier_type, ${r.value}, ${r.raw}, ${r.provider}, ${input.source.id})
      ON CONFLICT DO NOTHING RETURNING 1`);
    if (inserted.length === 0 && (r.type === "gtin" || r.type === "provider_product_id")) {
      const [owner] = await tx.execute<{ product_id: string }>(sql`
        SELECT product_id FROM product_identifiers
        WHERE identifier_type = ${r.type}::identifier_type AND value = ${r.value}
          AND provider IS NOT DISTINCT FROM ${r.provider}`);
      if (owner && owner.product_id !== productId)
        res.notes.push(
          `${r.type === "gtin" ? "GTIN" : "Provider ID"} ${r.value} already belongs to another product; not linked`,
        );
    }
  }
}

async function writeSpecs(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  product: Product,
  variantId: string | null,
  res: ImportOutcome,
) {
  const p = input.product;
  const productProtected = product.status === "verified" || product.status === "published";
  const variantKeys = new Set(Object.values(variantKeysFor(input.category?.slug ?? null)));
  const provProduct = await currentProvenance(tx, product.id, null);
  const provVariant = variantId ? await currentProvenance(tx, product.id, variantId) : new Map();
  for (const spec of p.specs) {
    const [productLevel] = await tx
      .select()
      .from(productSpecifications)
      .where(
        and(
          eq(productSpecifications.productId, product.id),
          eq(productSpecifications.specificationDefinitionId, spec.definitionId),
          isNull(productSpecifications.variantId),
        ),
      );
    const [variantLevel] = variantId
      ? await tx
          .select()
          .from(productSpecifications)
          .where(
            and(
              eq(productSpecifications.productId, product.id),
              eq(productSpecifications.specificationDefinitionId, spec.definitionId),
              eq(productSpecifications.variantId, variantId),
            ),
          )
      : [];
    // Variant-defining specs (storage, memory) of a second configuration go to the variant;
    // everything else is product-level unless the variant already overrides it.
    const sameAsProduct = productLevel && sameColumns(productLevel, spec);
    const variantScope =
      variantId !== null &&
      (Boolean(variantLevel) ||
        (variantKeys.has(spec.key) && Boolean(productLevel) && !sameAsProduct));
    const scopeVariant = variantScope ? variantId : null;
    const existing = variantScope ? variantLevel : productLevel;
    const prov = (variantScope ? provVariant : provProduct).get(specField(spec.key));
    const field = specField(spec.key);
    const label = variantScope ? `variant.${field}` : field;

    if (!existing) {
      await setSpecificationValue(ctx, specInput(input, product.id, scopeVariant, spec));
      await providerProvenance(
        tx,
        input,
        product.id,
        scopeVariant,
        field,
        spec.columns,
        spec.rawValue,
        true,
      );
      res.changes.push({ field: label, decision: res.status === "created" ? "created" : "set" });
      if (res.status === "unchanged") res.status = "updated";
      continue;
    }
    if (sameColumns(existing, spec)) {
      const current = !prov || prov.source_id === input.source.id;
      await providerProvenance(
        tx,
        input,
        product.id,
        scopeVariant,
        field,
        spec.columns,
        spec.rawValue,
        current,
      );
      continue;
    }
    const verified = existing.verificationStatus === "verified";
    const manual = existing.origin === "manual" || !existing.sourceId;
    let d: FieldDecision;
    if (verified || manual || productProtected) d = "conflict";
    else if (existing.sourceId === input.source.id) d = "set";
    else if ((existing.confidence ?? 0) > p.confidence) d = "lower_confidence";
    else d = "conflict";

    if (d === "set") {
      await setSpecificationValue(ctx, specInput(input, product.id, scopeVariant, spec));
      await providerProvenance(
        tx,
        input,
        product.id,
        scopeVariant,
        field,
        spec.columns,
        spec.rawValue,
        true,
      );
      res.changes.push({ field: label, decision: "set" });
      if (res.status === "unchanged") res.status = "updated";
    } else {
      await providerProvenance(
        tx,
        input,
        product.id,
        scopeVariant,
        field,
        spec.columns,
        spec.rawValue,
        false,
      );
      res.changes.push({ field: label, decision: d });
      if (d === "conflict") {
        const id = await queueSpecConflict(
          tx,
          ctx,
          input,
          existing,
          spec,
          product.id,
          scopeVariant,
        );
        res.reviewItemIds.push(id);
      }
    }
  }
}

function specInput(
  input: ImportInput,
  productId: string,
  variantId: string | null,
  spec: NormalizedSpec,
) {
  return {
    productId,
    variantId,
    key: spec.key,
    value: spec.input,
    sourceId: input.source.id,
    origin: "import" as const,
    confidence: input.product.confidence,
    verificationStatus: "unverified" as const,
    rawValue: spec.rawValue,
    rawUnit: spec.rawUnit,
  };
}

function sameColumns(
  row: typeof productSpecifications.$inferSelect,
  spec: NormalizedSpec,
): boolean {
  const c = spec.columns;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return (
    (row.valueText ?? null) === c.valueText &&
    num(row.valueNumeric) === num(c.valueNumeric) &&
    (row.valueBoolean ?? null) === c.valueBoolean &&
    (row.valueDate ?? null) === c.valueDate &&
    JSON.stringify(row.valueJson ?? null) === JSON.stringify(c.valueJson)
  );
}

/** A conflicting_value review item in the format the review queue already applies. */
async function queueSpecConflict(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  existing: typeof productSpecifications.$inferSelect,
  spec: NormalizedSpec,
  productId: string,
  variantId: string | null,
): Promise<string> {
  const [pending] = await tx
    .select({ id: reviewItems.id })
    .from(reviewItems)
    .where(
      and(
        eq(reviewItems.itemType, "conflicting_value"),
        eq(reviewItems.entityId, existing.id),
        eq(reviewItems.status, "open"),
        sql`${reviewItems.payload}->'proposed' = ${JSON.stringify(spec.columns)}::jsonb`,
      ),
    )
    .limit(1);
  if (pending) return pending.id;
  const item = await createReviewItem(tx, {
    itemType: "conflicting_value",
    entityType: "product_specification",
    entityId: existing.id,
    createdBy: ctx.actorId,
    payload: {
      productId,
      variantId,
      key: spec.key,
      current: {
        valueText: existing.valueText,
        valueNumeric: existing.valueNumeric,
        valueBoolean: existing.valueBoolean,
        valueDate: existing.valueDate,
        valueJson: existing.valueJson,
      },
      proposed: spec.columns,
      proposedSourceId: input.source.id,
      origin: "import",
      confidence: input.product.confidence,
      provider: input.product.provider,
      providerProductId: input.product.providerProductId,
      rawValue: spec.rawValue,
      rawUnit: spec.rawUnit,
    },
  });
  return item.id;
}

async function addImages(
  tx: Tx,
  ctx: ServiceContext,
  input: ImportInput,
  product: Product,
  res: ImportOutcome,
) {
  const p = input.product;
  if (input.source.licence.imageLicence === "none") return;
  const [{ n }] = (await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM product_images WHERE product_id = ${product.id}`)) as unknown as [
    { n: number },
  ];
  let order = Number(n);
  for (const img of p.images.slice(0, MAX_IMAGES)) {
    const [inserted] = await tx
      .insert(productImages)
      .values({
        productId: product.id,
        remoteUrl: img.url,
        width: img.width,
        height: img.height,
        author: normalizeText(img.author, 200),
        licenseType: normalizeText(img.licence, 200),
        licenseUrl: img.licenceUrl,
        attributionText: input.source.licence.attribution,
        altText: product.name,
        sourceId: input.source.id,
        rightsStatus: "needs_review",
        displayOrder: order++,
      })
      .onConflictDoNothing()
      .returning({ id: productImages.id });
    if (!inserted) continue;
    const item = await createReviewItem(tx, {
      itemType: "image_rights",
      entityType: "product_image",
      entityId: inserted.id,
      createdBy: ctx.actorId,
      payload: {
        productId: product.id,
        remoteUrl: img.url,
        author: img.author,
        licenseType: img.licence,
        licenseUrl: img.licenceUrl,
        provider: p.provider,
      },
    });
    res.reviewItemIds.push(item.id);
    res.changes.push({ field: "image", decision: res.status === "created" ? "created" : "set" });
    if (res.status === "unchanged") res.status = "updated";
  }
}

function rawRecordJson(raw: ProviderRecord | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  const json = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  if (JSON.stringify(json).length <= MAX_RAW_CHARS) return json;
  const features = (json.features as unknown[]) ?? [];
  return { ...json, description: null, features: features.slice(0, 300), truncated: true };
}

async function upsertSourceRecord(
  tx: Tx,
  input: ImportInput,
  productId: string,
  variantId: string | null,
  res: ImportOutcome,
) {
  const p = input.product;
  const l = input.source.licence;
  const values = {
    productId,
    variantId,
    sourceId: input.source.id,
    sourceProductIdentifier: p.providerProductId,
    providerProductId: p.providerProductId,
    sourceUrl: p.sourceUrl,
    retrievedAt: p.retrievedAt,
    payloadHash: p.payloadHash,
    lastSeenAt: p.retrievedAt,
    licenseType: l.name,
    licenseUrl: l.url,
    attributionText: l.attribution,
    providerQuality: p.quality,
    rawRecord: rawRecordJson(input.raw),
    unmappedFeatures: p.unmappedFeatures as unknown[],
  };
  const [byId] = await tx
    .select()
    .from(productSourceRecords)
    .where(
      and(
        eq(productSourceRecords.sourceId, input.source.id),
        eq(productSourceRecords.providerProductId, p.providerProductId),
      ),
    );
  if (byId) {
    await tx
      .update(productSourceRecords)
      .set({
        ...values,
        lastChangedAt: byId.payloadHash === p.payloadHash ? byId.lastChangedAt : p.retrievedAt,
      })
      .where(eq(productSourceRecords.id, byId.id));
    return;
  }
  const [sameSlot] = await tx
    .select({
      id: productSourceRecords.id,
      providerProductId: productSourceRecords.providerProductId,
    })
    .from(productSourceRecords)
    .where(
      and(
        eq(productSourceRecords.productId, productId),
        variantId
          ? eq(productSourceRecords.variantId, variantId)
          : isNull(productSourceRecords.variantId),
        eq(productSourceRecords.sourceId, input.source.id),
      ),
    );
  if (sameSlot) {
    if (sameSlot.providerProductId) {
      res.notes.push(
        `Another ${p.provider} record (${sameSlot.providerProductId}) is already linked here; this one is kept as an identifier only`,
      );
      return;
    }
    // A source row without a provider ID (e.g. entered by hand): attach the provider record to it.
    await tx
      .update(productSourceRecords)
      .set({ ...values, firstSeenAt: p.retrievedAt, lastChangedAt: p.retrievedAt })
      .where(eq(productSourceRecords.id, sameSlot.id));
    return;
  }
  await tx.insert(productSourceRecords).values({
    ...values,
    firstSeenAt: p.retrievedAt,
    lastChangedAt: p.retrievedAt,
  });
}

/**
 * Applies a reviewer's decision on a provider duplicate_candidate / variant_ambiguity item.
 * Choices: "new" (keep separate / new variant), a product ID (same product), "variant:<id>"
 * (a new configuration of that product), or — for variant ambiguity — a variant ID.
 */
export async function resolveProviderReview(
  ctx: ServiceContext,
  item: { itemType: string; payload: Record<string, unknown> },
  choice: string,
): Promise<ImportOutcome> {
  const p = item.payload;
  const input: ImportInput = {
    product: deserializeProduct(p.product),
    source: p.source as ImportSource,
    category: (p.category as ImportInput["category"]) ?? null,
  };
  const productId = typeof p.productId === "string" ? p.productId : null;
  let decision: ImportDecision;
  if (item.itemType === "variant_ambiguity") {
    if (!productId) throw new InvalidStateError("The review item has no product");
    if (choice === "new") decision = { mode: "variant", productId };
    else if ((p.variantIds as string[] | undefined)?.includes(choice))
      decision = { mode: "merge", productId, variantId: choice };
    else throw new InvalidStateError("Choose one of the listed variants or a new variant");
  } else {
    const candidates = new Set(
      ((p.candidates as { productId: string }[]) ?? []).map((c) => c.productId),
    );
    if (choice === "new") decision = { mode: "new" };
    else if (choice.startsWith("variant:") && candidates.has(choice.slice(8)))
      decision = { mode: "variant", productId: choice.slice(8) };
    else if (candidates.has(choice)) decision = { mode: "merge", productId: choice };
    else throw new InvalidStateError("Choose one of the listed products or a new product");
  }
  return importNormalizedProduct(ctx, { ...input, decision });
}
