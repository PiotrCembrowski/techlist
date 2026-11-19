import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { slugify } from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext, type Tx } from "@/modules/_shared/context";
import {
  NotFoundError,
  parseOrThrow,
  rethrowDbError,
  ValidationError,
} from "@/modules/_shared/errors";
import { onlyProvided } from "@/modules/_shared/patch";
import {
  variantBaseSchema,
  variantUpdateSchema,
  type VariantInput,
  type VariantUpdate,
} from "./schema";

export type ProductVariant = typeof productVariants.$inferSelect;

/** Max variants per product; keeps variant lists bounded. */
export const MAX_VARIANTS_PER_PRODUCT = 100;

async function clearOtherDefaults(tx: Tx, productId: string, keepId: string | null) {
  await tx
    .update(productVariants)
    .set({ isDefault: false })
    .where(
      and(
        eq(productVariants.productId, productId),
        eq(productVariants.isDefault, true),
        keepId ? ne(productVariants.id, keepId) : undefined,
      ),
    );
}

/**
 * Variants are never merged: each regional/configuration variant is its own row.
 * The first variant of a product becomes the default automatically.
 */
export async function createProductVariant(
  ctx: ServiceContext,
  productId: string,
  input: VariantInput,
): Promise<ProductVariant> {
  const data = parseOrThrow(variantBaseSchema, input, "Invalid variant");
  const variantCode = data.variantCode ?? slugify(data.variantName);
  if (!variantCode) throw new ValidationError("Cannot derive a variant code from the name");
  try {
    return await inTransaction(ctx, async (tx) => {
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, productId))
        .for("update");
      if (!product) throw new NotFoundError("Product", productId);
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(productVariants)
        .where(eq(productVariants.productId, productId))) as [{ n: number }];
      if (n >= MAX_VARIANTS_PER_PRODUCT)
        throw new ValidationError(
          `A product can have at most ${MAX_VARIANTS_PER_PRODUCT} variants`,
        );
      const isDefault = data.isDefault || n === 0;
      if (isDefault) await clearOtherDefaults(tx, productId, null);
      const [row] = await tx
        .insert(productVariants)
        .values({ ...data, variantCode, isDefault, productId })
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "product_variant",
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

export async function updateProductVariant(
  ctx: ServiceContext,
  id: string,
  patch: VariantUpdate,
): Promise<ProductVariant> {
  const data = onlyProvided(parseOrThrow(variantUpdateSchema, patch, "Invalid variant"), patch);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, id))
        .for("update");
      if (!before) throw new NotFoundError("Variant", id);
      if (Object.keys(data).length === 0) return before;
      if (data.isDefault === false && before.isDefault) {
        throw new ValidationError(
          "Choose another default variant instead of unsetting the default",
        );
      }
      if (data.isDefault) await clearOtherDefaults(tx, before.productId, id);
      const [row] = await tx
        .update(productVariants)
        .set(data)
        .where(eq(productVariants.id, id))
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "product_variant",
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

export function setDefaultVariant(ctx: ServiceContext, id: string) {
  return updateProductVariant(ctx, id, { isDefault: true });
}

export async function listVariants(db: DbOrTx, productId: string): Promise<ProductVariant[]> {
  return db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(desc(productVariants.isDefault), asc(productVariants.variantName))
    .limit(MAX_VARIANTS_PER_PRODUCT);
}

export async function getVariantByCode(
  db: DbOrTx,
  productId: string,
  code: string,
): Promise<ProductVariant | null> {
  const [row] = await db
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.productId, productId), eq(productVariants.variantCode, code)))
    .limit(1);
  return row ?? null;
}
