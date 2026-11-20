import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  products,
  productSpecifications,
  productVariants,
  specificationDefinitions,
  specificationGroups,
} from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service";
import { getCategoryAncestors, getCategoryDescendantIds } from "@/modules/categories/service";
import { inTransaction, MAX_PAGE_SIZE, type ServiceContext } from "@/modules/_shared/context";
import {
  ConflictError,
  NotFoundError,
  parseOrThrow,
  rethrowDbError,
  ValidationError,
} from "@/modules/_shared/errors";
import { createReviewItem } from "@/modules/review-queue/service";
import {
  assertDefinitionConsistent,
  DATA_TYPES,
  parseSpecificationValue,
  sameValue,
  type RawSpecValue,
  type SpecValueColumns,
} from "./parse";

export type SpecificationDefinition = typeof specificationDefinitions.$inferSelect;
export type SpecificationGroup = typeof specificationGroups.$inferSelect;
export type ProductSpecification = typeof productSpecifications.$inferSelect;

const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "Key must be snake_case")
  .max(64);

export const groupInputSchema = z.object({
  categoryId: z.uuid(),
  key: keySchema,
  name: z.string().trim().min(1).max(120),
  displayOrder: z.number().int().min(0).default(0),
});

export const definitionInputSchema = z.object({
  categoryId: z.uuid(),
  groupId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  key: keySchema,
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v || null),
  dataType: z.enum(DATA_TYPES),
  canonicalUnit: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .nullish()
    .transform((v) => v ?? null),
  displayOrder: z.number().int().min(0).default(0),
  isFilterable: z.boolean().default(false),
  isComparable: z.boolean().default(true),
  isRequired: z.boolean().default(false),
  isPublic: z.boolean().default(true),
  comparisonDirection: z.enum(["higher_is_better", "lower_is_better", "none"]).default("none"),
  validationRules: z.record(z.string(), z.unknown()).default({}),
});

/** Keys that exist anywhere in the inheritance chain of `categoryId` (ancestors + itself + descendants). */
async function keysInChain(
  tx: DbOrTx,
  table: "definitions" | "groups",
  categoryId: string,
): Promise<Set<string>> {
  const ancestors = await getCategoryAncestors(tx, categoryId);
  if (ancestors.length === 0) throw new NotFoundError("Category", categoryId);
  const descendants = await getCategoryDescendantIds(tx, categoryId);
  const ids = [...ancestors.map((a) => a.id), ...descendants];
  const t = table === "definitions" ? specificationDefinitions : specificationGroups;
  const rows = await tx.select({ key: t.key }).from(t).where(inArray(t.categoryId, ids));
  return new Set(rows.map((r) => r.key));
}

export async function createSpecificationGroup(
  ctx: ServiceContext,
  input: z.input<typeof groupInputSchema>,
) {
  const data = parseOrThrow(groupInputSchema, input, "Invalid specification group");
  try {
    return await inTransaction(ctx, async (tx) => {
      if ((await keysInChain(tx, "groups", data.categoryId)).has(data.key)) {
        throw new ConflictError(
          `Group key "${data.key}" already exists in this category's inheritance chain`,
        );
      }
      const [row] = await tx.insert(specificationGroups).values(data).returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "specification_group",
        entityId: row!.id,
        action: "create",
        next: row,
      });
      return row!;
    });
  } catch (e) {
    rethrowDbError(e);
  }
}

export async function createSpecificationDefinition(
  ctx: ServiceContext,
  input: z.input<typeof definitionInputSchema>,
) {
  const data = parseOrThrow(definitionInputSchema, input, "Invalid specification definition");
  const rules = assertDefinitionConsistent(data);
  try {
    return await inTransaction(ctx, async (tx) => {
      if ((await keysInChain(tx, "definitions", data.categoryId)).has(data.key)) {
        throw new ConflictError(
          `Specification key "${data.key}" already exists in this category's inheritance chain`,
        );
      }
      if (data.groupId) {
        const chain = await getCategoryAncestors(tx, data.categoryId);
        const [group] = await tx
          .select()
          .from(specificationGroups)
          .where(eq(specificationGroups.id, data.groupId));
        if (!group || !chain.some((c) => c.id === group.categoryId)) {
          throw new ValidationError(
            "The group must belong to the category or one of its ancestors",
          );
        }
      }
      const [row] = await tx
        .insert(specificationDefinitions)
        .values({ ...data, validationRules: rules })
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "specification_definition",
        entityId: row!.id,
        action: "create",
        next: row,
      });
      return row!;
    });
  } catch (e) {
    rethrowDbError(e);
  }
}

export interface EffectiveDefinition extends SpecificationDefinition {
  groupKey: string | null;
  groupName: string | null;
  groupOrder: number;
  /** 0 = defined on this category, 1 = parent, ... */
  inheritedDepth: number;
}

/**
 * Definitions that apply to a category, including those inherited from ancestors.
 * One recursive query; ordered by group, then root-first, then display order.
 */
export async function getEffectiveDefinitions(
  db: DbOrTx,
  categoryId: string,
): Promise<EffectiveDefinition[]> {
  return (await getEffectiveDefinitionsForCategories(db, [categoryId])).get(categoryId) ?? [];
}

/** Effective definitions for several categories in one recursive query (no N+1 on listing pages). */
export async function getEffectiveDefinitionsForCategories(
  db: DbOrTx,
  categoryIds: string[],
): Promise<Map<string, EffectiveDefinition[]>> {
  const out = new Map<string, EffectiveDefinition[]>(categoryIds.map((id) => [id, []]));
  if (categoryIds.length === 0) return out;
  const rows = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id AS root_id, id, parent_id, 0 AS depth FROM categories WHERE id = ANY(${sql.param(categoryIds)}::uuid[])
      UNION ALL
      SELECT chain.root_id, c.id, c.parent_id, chain.depth + 1 FROM categories c JOIN chain ON c.id = chain.parent_id
      WHERE chain.depth < 8
    )
    SELECT chain.root_id,
           d.id, d.category_id, d.group_id, d.key, d.name, d.description, d.data_type, d.canonical_unit,
           d.display_order, d.is_filterable, d.is_comparable, d.is_required, d.is_public,
           d.comparison_direction, d.validation_rules, d.created_at, d.updated_at,
           g.key AS group_key, g.name AS group_name, coalesce(g.display_order, 9999) AS group_order,
           chain.depth AS inherited_depth
    FROM chain
    JOIN specification_definitions d ON d.category_id = chain.id
    LEFT JOIN specification_groups g ON g.id = d.group_id
    ORDER BY chain.root_id, group_order, g.key NULLS LAST, chain.depth DESC, d.display_order, d.key`);
  for (const r of rows) out.get(r.root_id as string)?.push(toEffectiveDefinition(r));
  return out;
}

function toEffectiveDefinition(r: Record<string, unknown>): EffectiveDefinition {
  return {
    id: r.id as string,
    categoryId: r.category_id as string,
    groupId: (r.group_id as string | null) ?? null,
    key: r.key as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    dataType: r.data_type as SpecificationDefinition["dataType"],
    canonicalUnit: (r.canonical_unit as string | null) ?? null,
    displayOrder: Number(r.display_order),
    isFilterable: Boolean(r.is_filterable),
    isComparable: Boolean(r.is_comparable),
    isRequired: Boolean(r.is_required),
    isPublic: Boolean(r.is_public),
    comparisonDirection: r.comparison_direction as SpecificationDefinition["comparisonDirection"],
    validationRules: (r.validation_rules as Record<string, unknown>) ?? {},
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    groupKey: (r.group_key as string | null) ?? null,
    groupName: (r.group_name as string | null) ?? null,
    groupOrder: Number(r.group_order),
    inheritedDepth: Number(r.inherited_depth),
  };
}

export interface SetSpecificationInput {
  productId: string;
  variantId?: string | null;
  /** Definition key (resolved through the product category's inheritance chain). */
  key: string;
  value: RawSpecValue;
  sourceId?: string | null;
  origin?: "manual" | "import" | "ai_extracted";
  confidence?: number | null;
  /** Requesting "verified" stamps last_verified_at. Ignored (forced to unverified) for AI-extracted values. */
  verificationStatus?: "unverified" | "verified";
}

export type SetSpecificationResult =
  | { outcome: "created" | "updated"; specification: ProductSpecification }
  | { outcome: "unchanged"; specification: ProductSpecification }
  | { outcome: "review_required"; reviewItemId: string; specification: ProductSpecification };

/**
 * Sets one specification value. Rules enforced here:
 *  - the definition must apply to the product's category (inheritance included);
 *  - values are parsed into the canonical unit and validated against the definition's rules;
 *  - AI-extracted values are always stored as unverified and queued for review (rule 2.1.8);
 *  - a verified value is never overwritten by unverified data — a `conflicting_value` review
 *    item is created instead (rule 2.1.7).
 */
export async function setSpecificationValue(
  ctx: ServiceContext,
  input: SetSpecificationInput,
): Promise<SetSpecificationResult> {
  const origin = input.origin ?? "manual";
  const confidence = input.confidence ?? null;
  if (confidence !== null && (confidence < 0 || confidence > 1))
    throw new ValidationError("confidence must be between 0 and 1");
  const status =
    origin === "ai_extracted" ? "unverified" : (input.verificationStatus ?? "unverified");
  const variantId = input.variantId ?? null;

  try {
    return await inTransaction(ctx, async (tx) => {
      const [product] = await tx
        .select({ id: products.id, categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, input.productId));
      if (!product) throw new NotFoundError("Product", input.productId);
      if (variantId) {
        const [variant] = await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, product.id)));
        if (!variant) throw new ValidationError("The variant does not belong to this product");
      }
      const defs = await getEffectiveDefinitions(tx, product.categoryId);
      const def = defs.find((d) => d.key === input.key);
      if (!def)
        throw new ValidationError(
          `"${input.key}" is not a specification of this product's category`,
        );

      const value = parseSpecificationValue(def, input.value);
      const [existing] = await tx
        .select()
        .from(productSpecifications)
        .where(
          and(
            eq(productSpecifications.productId, product.id),
            eq(productSpecifications.specificationDefinitionId, def.id),
            variantId
              ? eq(productSpecifications.variantId, variantId)
              : isNull(productSpecifications.variantId),
          ),
        )
        .for("update");

      if (existing && sameValue(existing, value)) {
        // Same value: only an explicit human verification changes anything.
        if (status === "verified" && existing.verificationStatus !== "verified") {
          const [row] = await tx
            .update(productSpecifications)
            .set({
              verificationStatus: "verified",
              lastVerifiedAt: new Date(),
              sourceId: input.sourceId ?? existing.sourceId,
            })
            .where(eq(productSpecifications.id, existing.id))
            .returning();
          await recordAudit(tx, {
            actorId: ctx.actorId,
            entityType: "product_specification",
            entityId: existing.id,
            action: "verify",
            previous: existing,
            next: row,
          });
          return { outcome: "updated", specification: row! };
        }
        return { outcome: "unchanged", specification: existing };
      }

      if (existing?.verificationStatus === "verified" && status !== "verified") {
        const item = await createReviewItem(tx, {
          itemType: "conflicting_value",
          entityType: "product_specification",
          entityId: existing.id,
          createdBy: ctx.actorId,
          payload: {
            productId: product.id,
            variantId,
            key: def.key,
            current: pickValue(existing),
            proposed: value,
            proposedSourceId: input.sourceId ?? null,
            origin,
            confidence,
          },
        });
        return { outcome: "review_required", reviewItemId: item.id, specification: existing };
      }

      const fields = {
        ...value,
        sourceId: input.sourceId ?? null,
        origin,
        confidence,
        verificationStatus: status,
        lastVerifiedAt: status === "verified" ? new Date() : null,
      } as const;

      let row: ProductSpecification;
      if (existing) {
        [row] = (await tx
          .update(productSpecifications)
          .set(fields)
          .where(eq(productSpecifications.id, existing.id))
          .returning()) as [ProductSpecification];
      } else {
        [row] = (await tx
          .insert(productSpecifications)
          .values({
            productId: product.id,
            variantId,
            specificationDefinitionId: def.id,
            ...fields,
          })
          .returning()) as [ProductSpecification];
      }
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "product_specification",
        entityId: row.id,
        action: existing ? "update" : "create",
        previous: existing,
        next: row,
      });

      if (origin === "ai_extracted") {
        await createReviewItem(tx, {
          itemType: "unverified_spec",
          entityType: "product_specification",
          entityId: row.id,
          createdBy: ctx.actorId,
          payload: { productId: product.id, variantId, key: def.key, value, confidence },
        });
      }
      return { outcome: existing ? "updated" : "created", specification: row };
    });
  } catch (e) {
    rethrowDbError(e);
  }
}

function pickValue(s: SpecValueColumns): SpecValueColumns {
  return {
    valueText: s.valueText,
    valueNumeric: s.valueNumeric,
    valueBoolean: s.valueBoolean,
    valueDate: s.valueDate,
    valueJson: s.valueJson,
  };
}

export interface ResolvedSpecification {
  definition: EffectiveDefinition;
  value: ProductSpecification;
  /** True when the value comes from the variant rather than the product. */
  isVariantOverride: boolean;
}

/** Resolve product-level values with variant overrides applied. */
export function resolveVariantOverrides(
  defs: EffectiveDefinition[],
  rows: ProductSpecification[],
  variantId: string | null,
): ResolvedSpecification[] {
  const byDef = new Map<string, ProductSpecification>();
  for (const r of rows) {
    if (r.variantId && r.variantId !== variantId) continue;
    const current = byDef.get(r.specificationDefinitionId);
    if (!current || (r.variantId && !current.variantId)) byDef.set(r.specificationDefinitionId, r);
  }
  const out: ResolvedSpecification[] = [];
  for (const d of defs) {
    const v = byDef.get(d.id);
    if (v) out.push({ definition: d, value: v, isVariantOverride: v.variantId !== null });
  }
  return out;
}

/** All resolved values for one product (and optionally one variant). Two queries total. */
export async function getProductSpecifications(
  db: DbOrTx,
  productId: string,
  variantId: string | null = null,
): Promise<ResolvedSpecification[]> {
  const [product] = await db
    .select({ categoryId: products.categoryId })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw new NotFoundError("Product", productId);
  const defs = await getEffectiveDefinitions(db, product.categoryId);
  const rows = await db
    .select()
    .from(productSpecifications)
    .where(
      and(
        eq(productSpecifications.productId, productId),
        variantId
          ? or(
              isNull(productSpecifications.variantId),
              eq(productSpecifications.variantId, variantId),
            )
          : isNull(productSpecifications.variantId),
      ),
    );
  return resolveVariantOverrides(defs, rows, variantId);
}

/** Product-level values for a page of products in a single query (no N+1). */
export async function getSpecificationsForProducts(
  db: DbOrTx,
  productIds: string[],
  definitionIds?: string[],
): Promise<Map<string, ProductSpecification[]>> {
  if (productIds.length === 0) return new Map();
  if (productIds.length > MAX_PAGE_SIZE * 2)
    throw new ValidationError(`At most ${MAX_PAGE_SIZE * 2} products per call`);
  const rows = await db
    .select()
    .from(productSpecifications)
    .where(
      and(
        inArray(productSpecifications.productId, productIds),
        isNull(productSpecifications.variantId),
        definitionIds && definitionIds.length > 0
          ? inArray(productSpecifications.specificationDefinitionId, definitionIds)
          : undefined,
      ),
    );
  const map = new Map<string, ProductSpecification[]>(productIds.map((id) => [id, []]));
  for (const r of rows) map.get(r.productId)!.push(r);
  return map;
}
