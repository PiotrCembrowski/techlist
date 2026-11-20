/**
 * Admin-side catalogue operations that complement the core product/brand/spec services:
 * relationships, provenance (source records), manufacturer links, images, logos, spec value
 * removal and definition edits. Every mutation runs in a transaction with an audit entry.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  brands,
  productImages,
  productLinks,
  productRelationships,
  products,
  productSourceRecords,
  productSpecifications,
  productVariants,
  sources,
  specificationDefinitions,
} from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { checkImageUpload, getStorage, newStorageKey } from "@/lib/storage";
import { httpsUrlSchema } from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import {
  NotFoundError,
  parseOrThrow,
  rethrowDbError,
  ValidationError,
} from "@/modules/_shared/errors";
import { onlyProvided } from "@/modules/_shared/patch";
import { assertDefinitionConsistent } from "@/modules/specifications/parse";

// ─── Relationships ─────────────────────────────────────────────────────────────────────

const relationshipSchema = z.object({
  productId: z.uuid(),
  otherProductId: z.uuid(),
  /** "predecessor" is stored as a successor row in the other direction (never both). */
  kind: z.enum([
    "successor",
    "predecessor",
    "alternative",
    "competitor",
    "compatible_with",
    "accessory_for",
    "related",
  ]),
  sourceId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
});

export async function addRelationship(
  ctx: ServiceContext,
  input: z.input<typeof relationshipSchema>,
) {
  const d = parseOrThrow(relationshipSchema, input, "Invalid relationship");
  if (d.productId === d.otherProductId)
    throw new ValidationError("A product cannot be related to itself");
  const [sourceProductId, targetProductId, relationshipType] =
    d.kind === "predecessor"
      ? [d.otherProductId, d.productId, "successor" as const]
      : [d.productId, d.otherProductId, d.kind];
  try {
    return await inTransaction(ctx, async (tx) => {
      if (relationshipType === "successor") {
        const [reverse] = await tx
          .select({ id: productRelationships.id })
          .from(productRelationships)
          .where(
            and(
              eq(productRelationships.sourceProductId, targetProductId),
              eq(productRelationships.targetProductId, sourceProductId),
              eq(productRelationships.relationshipType, "successor"),
            ),
          );
        if (reverse) throw new ValidationError("The opposite succession already exists");
      }
      const [row] = await tx
        .insert(productRelationships)
        .values({
          sourceProductId,
          targetProductId,
          relationshipType,
          sourceId: d.sourceId,
          isVerified: true,
        })
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "product_relationship",
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

export async function removeRelationship(ctx: ServiceContext, id: string) {
  await inTransaction(ctx, async (tx) => {
    const [before] = await tx
      .delete(productRelationships)
      .where(eq(productRelationships.id, id))
      .returning();
    if (!before) throw new NotFoundError("Relationship", id);
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "product_relationship",
      entityId: id,
      action: "delete",
      previous: before,
    });
  });
}

// ─── Source records and manufacturer links ─────────────────────────────────────────────

const sourceRecordSchema = z.object({
  productId: z.uuid(),
  variantId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  sourceId: z.uuid(),
  sourceProductIdentifier: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  sourceUrl: z
    .url()
    .nullish()
    .transform((v) => v ?? null),
  retrievedAt: z.coerce
    .date()
    .nullish()
    .transform((v) => v ?? null),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v || null),
});

export async function addSourceRecord(
  ctx: ServiceContext,
  input: z.input<typeof sourceRecordSchema>,
) {
  const d = parseOrThrow(sourceRecordSchema, input, "Invalid source record");
  try {
    return await inTransaction(ctx, async (tx) => {
      const [src] = await tx.select().from(sources).where(eq(sources.id, d.sourceId));
      if (!src) throw new NotFoundError("Source", d.sourceId);
      if (!src.usagePermitted)
        throw new ValidationError(
          `"${src.sourceName}" does not permit use of its data (rule 2.1.9)`,
        );
      const [row] = await tx.insert(productSourceRecords).values(d).returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "product_source_record",
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

export async function removeSourceRecord(ctx: ServiceContext, id: string) {
  await inTransaction(ctx, async (tx) => {
    const [before] = await tx
      .delete(productSourceRecords)
      .where(eq(productSourceRecords.id, id))
      .returning();
    if (!before) throw new NotFoundError("Source record", id);
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "product_source_record",
      entityId: id,
      action: "delete",
      previous: before,
    });
  });
}

const linkSchema = z.object({
  productId: z.uuid(),
  linkType: z.enum(["official", "support", "manual", "driver", "spec_sheet"]),
  url: httpsUrlSchema,
  sourceId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
});

export async function addProductLink(ctx: ServiceContext, input: z.input<typeof linkSchema>) {
  const d = parseOrThrow(linkSchema, input, "Invalid link");
  try {
    return await inTransaction(ctx, async (tx) => {
      const [row] = await tx.insert(productLinks).values(d).returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "product_link",
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

export async function removeProductLink(ctx: ServiceContext, id: string) {
  await inTransaction(ctx, async (tx) => {
    const [before] = await tx.delete(productLinks).where(eq(productLinks.id, id)).returning();
    if (!before) throw new NotFoundError("Link", id);
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "product_link",
      entityId: id,
      action: "delete",
      previous: before,
    });
  });
}

// ─── Images (uploaded files only — never hotlinked) ────────────────────────────────────

const imageMetaSchema = z.object({
  productId: z.uuid(),
  variantId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  altText: z.string().trim().min(3, "Describe the image for screen readers").max(300),
  imageType: z.enum(["product", "detail", "packaging", "lifestyle"]).default("product"),
  sourceId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  licenseType: z.string().trim().min(1, "Record the image licence").max(120),
  attributionText: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
});

export async function uploadProductImage(
  ctx: ServiceContext,
  file: File | null,
  meta: z.input<typeof imageMetaSchema>,
) {
  const d = parseOrThrow(imageMetaSchema, meta, "Invalid image details");
  const check = await checkImageUpload(file);
  if (!check.ok)
    throw new ValidationError(check.message, [{ path: "file", message: check.message }]);
  const key = newStorageKey("products", check.kind.ext);
  const storage = getStorage();
  await storage.put(key, check.bytes, check.kind.contentType);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [p] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, d.productId))
        .for("update");
      if (!p) throw new NotFoundError("Product", d.productId);
      if (d.variantId) {
        const [v] = await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(
            and(eq(productVariants.id, d.variantId), eq(productVariants.productId, d.productId)),
          );
        if (!v) throw new ValidationError("The variant does not belong to this product");
      }
      const [{ n }] = (await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM product_images WHERE product_id = ${d.productId}`)) as unknown as [
        { n: number },
      ];
      const [row] = await tx
        .insert(productImages)
        .values({ ...d, storageKey: key, isPrimary: Number(n) === 0, displayOrder: Number(n) })
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "product_image",
        entityId: row!.id,
        action: "create",
        next: row,
      });
      return row!;
    });
  } catch (e) {
    await storage.delete(key).catch(() => {});
    rethrowDbError(e);
  }
}

export async function setPrimaryImage(ctx: ServiceContext, imageId: string) {
  await inTransaction(ctx, async (tx) => {
    const [img] = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.id, imageId))
      .for("update");
    if (!img) throw new NotFoundError("Image", imageId);
    await tx
      .update(productImages)
      .set({ isPrimary: false })
      .where(and(eq(productImages.productId, img.productId), eq(productImages.isPrimary, true)));
    await tx.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, imageId));
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "product_image",
      entityId: imageId,
      action: "set_primary",
      previous: img,
    });
  });
}

export async function deleteProductImage(ctx: ServiceContext, imageId: string) {
  const removed = await inTransaction(ctx, async (tx) => {
    const [img] = await tx.delete(productImages).where(eq(productImages.id, imageId)).returning();
    if (!img) throw new NotFoundError("Image", imageId);
    if (img.isPrimary) {
      // Promote the next image so the product keeps a primary one.
      await tx.execute(sql`
        UPDATE product_images SET is_primary = true
        WHERE id = (SELECT id FROM product_images WHERE product_id = ${img.productId} ORDER BY display_order, created_at LIMIT 1)`);
    }
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "product_image",
      entityId: imageId,
      action: "delete",
      previous: img,
    });
    return img;
  });
  await getStorage()
    .delete(removed.storageKey)
    .catch(() => {});
}

export async function setBrandLogo(ctx: ServiceContext, brandId: string, file: File | null) {
  const check = await checkImageUpload(file);
  if (!check.ok)
    throw new ValidationError(check.message, [{ path: "file", message: check.message }]);
  const key = newStorageKey("brands", check.kind.ext);
  const storage = getStorage();
  await storage.put(key, check.bytes, check.kind.contentType);
  const previous = await inTransaction(ctx, async (tx) => {
    const [before] = await tx.select().from(brands).where(eq(brands.id, brandId)).for("update");
    if (!before) throw new NotFoundError("Brand", brandId);
    const [row] = await tx
      .update(brands)
      .set({ logoImageKey: key })
      .where(eq(brands.id, brandId))
      .returning();
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "brand",
      entityId: brandId,
      action: "logo",
      previous: before,
      next: row,
    });
    return before.logoImageKey;
  }).catch(async (e) => {
    await storage.delete(key).catch(() => {});
    throw e;
  });
  if (previous) await storage.delete(previous).catch(() => {});
}

// ─── Specification values and definitions ──────────────────────────────────────────────

export async function clearSpecificationValue(ctx: ServiceContext, specificationId: string) {
  await inTransaction(ctx, async (tx) => {
    const [before] = await tx
      .delete(productSpecifications)
      .where(eq(productSpecifications.id, specificationId))
      .returning();
    if (!before) throw new NotFoundError("Specification value", specificationId);
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "product_specification",
      entityId: specificationId,
      action: "delete",
      previous: before,
    });
  });
}

const definitionUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((v) => v || null),
    groupId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    dataType: z.enum(["text", "integer", "decimal", "boolean", "date", "enum", "multi_select"]),
    canonicalUnit: z
      .string()
      .trim()
      .max(16)
      .nullish()
      .transform((v) => v || null),
    displayOrder: z.number().int().min(0),
    isFilterable: z.boolean(),
    isComparable: z.boolean(),
    isRequired: z.boolean(),
    isPublic: z.boolean(),
    comparisonDirection: z.enum(["higher_is_better", "lower_is_better", "none"]),
    validationRules: z.record(z.string(), z.unknown()),
  })
  .partial();

/** Type and unit are frozen once values exist (stored values would silently change meaning). */
export async function updateSpecificationDefinition(
  ctx: ServiceContext,
  id: string,
  patch: z.input<typeof definitionUpdateSchema>,
) {
  const data = onlyProvided(
    parseOrThrow(definitionUpdateSchema, patch, "Invalid definition"),
    patch,
  );
  try {
    return await inTransaction(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(specificationDefinitions)
        .where(eq(specificationDefinitions.id, id))
        .for("update");
      if (!before) throw new NotFoundError("Specification definition", id);
      const merged = { ...before, ...data };
      const rules = assertDefinitionConsistent(merged);
      if (
        (data.dataType !== undefined && data.dataType !== before.dataType) ||
        (data.canonicalUnit !== undefined && data.canonicalUnit !== before.canonicalUnit)
      ) {
        const [used] = await tx
          .select({ id: productSpecifications.id })
          .from(productSpecifications)
          .where(eq(productSpecifications.specificationDefinitionId, id))
          .limit(1);
        if (used)
          throw new ValidationError(
            "Type and unit cannot change while products have values for this specification",
          );
      }
      const [row] = await tx
        .update(specificationDefinitions)
        .set({ ...data, ...(data.validationRules !== undefined ? { validationRules: rules } : {}) })
        .where(eq(specificationDefinitions.id, id))
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "specification_definition",
        entityId: id,
        action: "update",
        previous: before,
        next: row,
      });
      return row!;
    });
  } catch (e) {
    rethrowDbError(e);
  }
}

// ─── Brand duplicates ──────────────────────────────────────────────────────────────────

/** SPEC §9.4: likely duplicates by trigram similarity (case- and accent-insensitive). */
export async function findSimilarBrands(db: DbOrTx, name: string, excludeId?: string) {
  const rows = await db.execute<{ id: string; name: string; slug: string; score: number }>(sql`
    SELECT id, name, slug, similarity(lower(sb_unaccent(name)), lower(sb_unaccent(${name}))) AS score
    FROM brands
    WHERE similarity(lower(sb_unaccent(name)), lower(sb_unaccent(${name}))) >= 0.4
      ${excludeId ? sql`AND id <> ${excludeId}` : sql``}
    ORDER BY score DESC LIMIT 5`);
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, score: Number(r.score) }));
}
