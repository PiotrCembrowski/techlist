import { eq } from "drizzle-orm";
import { productImages } from "@/db/schema";
import { recordAudit } from "@/modules/audit/service";
import type { ServiceContext, Tx } from "@/modules/_shared/context";
import { InvalidStateError, NotFoundError, ValidationError } from "@/modules/_shared/errors";

/**
 * Review items created by the provider import system (DECISIONS D78).
 *
 * `field_conflict` payload: { productId, variantId: string | null, field, current, proposed,
 * sourceId, provider, providerProductId }. `field` is one of the fields below; specification values
 * use `conflicting_value` instead.
 *
 * `image_rights` entity: a product_images row with a remote URL; payload: { productId, remoteUrl,
 * author, licenseType, licenseUrl, provider }.
 */
export const FIELD_CONFLICT_FIELDS = {
  product: [
    "name",
    "modelName",
    "modelNumber",
    "manufacturerPartNumber",
    "releaseDate",
    "announcedDate",
    "discontinuedDate",
    "shortDescription",
    "description",
  ],
  variant: ["variantName", "manufacturerPartNumber", "color", "barcodeGtin"],
} as const;

export interface FieldConflictPayload {
  productId: string;
  variantId: string | null;
  field: string;
  current: unknown;
  proposed: unknown;
  sourceId: string;
  provider?: string;
  providerProductId?: string;
}

export function isFieldConflictPayload(
  p: Record<string, unknown>,
): p is Record<string, unknown> & FieldConflictPayload {
  const fields: readonly string[] = p.variantId
    ? FIELD_CONFLICT_FIELDS.variant
    : FIELD_CONFLICT_FIELDS.product;
  return typeof p.productId === "string" && typeof p.field === "string" && fields.includes(p.field);
}

/** Applies the proposed (or the reviewer's edited) value through the normal services. */
export async function applyFieldConflict(
  sctx: ServiceContext,
  payload: Record<string, unknown>,
  edited: string | undefined,
) {
  if (!isFieldConflictPayload(payload))
    throw new InvalidStateError("This conflict refers to a field that cannot be changed here");
  const raw = edited !== undefined ? edited.trim() : payload.proposed;
  const value = raw === "" ? null : raw;
  if (value !== null && typeof value !== "string")
    throw new ValidationError("The proposed value is not text");
  if (payload.variantId) {
    const { updateProductVariant } = await import("@/modules/variants/service");
    await updateProductVariant(sctx, payload.variantId, { [payload.field]: value });
  } else {
    const { updateProduct } = await import("@/modules/products/service");
    await updateProduct(sctx, payload.productId, { [payload.field]: value });
  }
}

/** Approves or rejects the use of a provider-hosted image (only approved ones are public). */
export async function setImageRights(
  tx: Tx,
  ctx: ServiceContext,
  imageId: string,
  status: "approved" | "rejected",
) {
  const [before] = await tx
    .select()
    .from(productImages)
    .where(eq(productImages.id, imageId))
    .for("update");
  if (!before) throw new NotFoundError("Image", imageId);
  const [row] = await tx
    .update(productImages)
    .set({ rightsStatus: status, ...(status === "rejected" ? { isPrimary: false } : {}) })
    .where(eq(productImages.id, imageId))
    .returning();
  await recordAudit(tx, {
    actorId: ctx.actorId,
    entityType: "product_image",
    entityId: imageId,
    action: `rights:${status}`,
    previous: before,
    next: row,
  });
}
