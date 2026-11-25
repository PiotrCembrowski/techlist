"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { products } from "@/db/schema";
import { adminAction, bool, file, list, req, str } from "@/lib/admin/action";
import {
  addProductLink,
  addRelationship,
  addSourceRecord,
  clearSpecificationValue,
  deleteProductImage,
  removeProductLink,
  removeRelationship,
  removeSourceRecord,
  setPrimaryImage,
  uploadProductImage,
} from "@/modules/catalog-admin/service";
import { ServiceError, ValidationError } from "@/modules/_shared/errors";
import {
  createProduct,
  deleteDraftProduct,
  setProductStatus,
  updateProduct,
} from "@/modules/products/service";
import { isCatalogStatus, STATUS_LABELS, type CatalogStatus } from "@/modules/products/status";
import {
  getEffectiveDefinitions,
  getProductSpecifications,
  setSpecificationValue,
} from "@/modules/specifications/service";
import {
  createProductVariant,
  setDefaultVariant,
  updateProductVariant,
} from "@/modules/variants/service";

function productFields(fd: FormData) {
  return {
    brandId: req(fd, "brandId"),
    categoryId: req(fd, "categoryId"),
    name: req(fd, "name"),
    slug: str(fd, "slug") ?? undefined,
    modelName: str(fd, "modelName"),
    modelNumber: str(fd, "modelNumber"),
    manufacturerPartNumber: str(fd, "manufacturerPartNumber"),
    aliases: list(fd, "aliases"),
    shortDescription: str(fd, "shortDescription"),
    description: str(fd, "description"),
    releaseDate: str(fd, "releaseDate"),
    announcedDate: str(fd, "announcedDate"),
    discontinuedDate: str(fd, "discontinuedDate"),
    productStatus: (str(fd, "productStatus") ?? "unknown") as
      "announced" | "active" | "discontinued" | "unknown",
    isFeatured: bool(fd, "isFeatured"),
    isDemo: bool(fd, "isDemo"),
    seoTitle: str(fd, "seoTitle"),
    seoDescription: str(fd, "seoDescription"),
  };
}

export const createProductAction = adminAction(async ({ ctx }, fd) => {
  const p = await createProduct(ctx, productFields(fd));
  redirect(`/admin/products/${p.id}?created=1`);
});

export const updateProductAction = adminAction(async ({ ctx }, fd) => {
  const fields = productFields(fd);
  if (!fields.slug) delete fields.slug;
  await updateProduct(ctx, req(fd, "id"), fields);
  return "Product saved";
});

/** One action for every status change; `op` is the target status or `delete`. */
export const productStatusAction = adminAction(async ({ ctx }, fd) => {
  const id = req(fd, "id");
  const op = str(fd, "op");
  if (op === "delete") {
    await deleteDraftProduct(ctx, id, {
      confirm: bool(fd, "confirm") || str(fd, "confirm") === "yes",
    });
    redirect("/admin/products?deleted=1");
  }
  if (!isCatalogStatus(op)) throw new ValidationError("Unknown operation");
  const p = await setProductStatus(ctx, id, op);
  return `Status: ${STATUS_LABELS[p.status]}`;
});

function variantFields(fd: FormData) {
  return {
    variantName: req(fd, "variantName"),
    variantCode: str(fd, "variantCode") ?? undefined,
    manufacturerPartNumber: str(fd, "manufacturerPartNumber"),
    regionCode: str(fd, "regionCode")?.toUpperCase() ?? null,
    color: str(fd, "color"),
    memoryConfiguration: str(fd, "memoryConfiguration"),
    storageConfiguration: str(fd, "storageConfiguration"),
    configurationLabel: str(fd, "configurationLabel"),
    barcodeGtin: str(fd, "barcodeGtin"),
    sku: str(fd, "sku"),
    status: isCatalogStatus(str(fd, "status")) ? (str(fd, "status") as CatalogStatus) : undefined,
  };
}

export const createVariantAction = adminAction(async ({ ctx }, fd) => {
  await createProductVariant(ctx, req(fd, "productId"), {
    ...variantFields(fd),
    isDefault: bool(fd, "isDefault"),
  });
  return "Variant added";
});

export const updateVariantAction = adminAction(async ({ ctx }, fd) => {
  const fields = variantFields(fd);
  if (!fields.variantCode) delete fields.variantCode;
  await updateProductVariant(ctx, req(fd, "id"), fields);
  if (bool(fd, "makeDefault")) await setDefaultVariant(ctx, req(fd, "id"));
  return "Variant saved";
});

/**
 * Saves the specification form: non-empty fields are set (parsed into canonical units), emptied
 * fields that had a value are cleared. Verified values are protected by the service (a review
 * item is created instead) unless this editor marks their input as verified.
 */
export const saveSpecificationsAction = adminAction(async ({ ctx }, fd) => {
  const productId = req(fd, "productId");
  const variantId = str(fd, "variantId");
  const [product] = await ctx.db
    .select({ categoryId: products.categoryId })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw new ValidationError("Product not found");
  const defs = await getEffectiveDefinitions(ctx.db, product.categoryId);
  const current = await getProductSpecifications(ctx.db, productId, variantId);
  const currentRow = new Map(
    current
      .filter((c) => (variantId ? c.value.variantId === variantId : c.value.variantId === null))
      .map((c) => [c.definition.key, c.value]),
  );
  const verified = bool(fd, "markVerified");
  const sourceId = str(fd, "sourceId");
  const errors: { path: string; message: string }[] = [];
  let saved = 0;
  let review = 0;
  let cleared = 0;
  for (const d of defs) {
    const name = `spec.${d.key}`;
    const raw =
      d.dataType === "multi_select" ? fd.getAll(name).map(String).filter(Boolean) : str(fd, name);
    const empty = raw === null || (Array.isArray(raw) && raw.length === 0);
    try {
      if (empty) {
        const existing = currentRow.get(d.key);
        if (existing && fd.has(`present.${d.key}`)) {
          await clearSpecificationValue(ctx, existing.id);
          cleared++;
        }
        continue;
      }
      const r = await setSpecificationValue(ctx, {
        productId,
        variantId,
        key: d.key,
        value: raw as string | string[],
        sourceId,
        origin: "manual",
        verificationStatus: verified ? "verified" : "unverified",
      });
      if (r.outcome === "created" || r.outcome === "updated") saved++;
      if (r.outcome === "review_required") review++;
    } catch (e) {
      if (e instanceof ServiceError) errors.push({ path: name, message: e.message });
      else throw e;
    }
  }
  if (errors.length) {
    throw new ValidationError(
      `${errors.length} value(s) could not be saved; ${saved} saved.`,
      errors,
    );
  }
  return [
    `${saved} value(s) saved`,
    cleared ? `${cleared} cleared` : null,
    review ? `${review} sent to the review queue (would overwrite a verified value)` : null,
  ]
    .filter(Boolean)
    .join(", ");
});

export const uploadImageAction = adminAction(async ({ ctx }, fd) => {
  await uploadProductImage(ctx, file(fd, "file"), {
    productId: req(fd, "productId"),
    variantId: str(fd, "variantId"),
    altText: req(fd, "altText"),
    imageType: (str(fd, "imageType") ?? "product") as "product",
    sourceId: str(fd, "sourceId"),
    licenseType: req(fd, "licenseType"),
    attributionText: str(fd, "attributionText"),
  });
  return "Image uploaded";
});

export const imageOpAction = adminAction(async ({ ctx }, fd) => {
  const id = req(fd, "imageId");
  if (str(fd, "op") === "delete") {
    await deleteProductImage(ctx, id);
    return "Image deleted";
  }
  await setPrimaryImage(ctx, id);
  return "Primary image set";
});

export const addRelationshipAction = adminAction(async ({ ctx }, fd) => {
  await addRelationship(ctx, {
    productId: req(fd, "productId"),
    otherProductId: req(fd, "otherProductId"),
    kind: req(fd, "kind") as "successor",
    sourceId: str(fd, "sourceId"),
  });
  return "Relationship added";
});

export const removeRelationshipAction = adminAction(async ({ ctx }, fd) => {
  await removeRelationship(ctx, req(fd, "id"));
  return "Relationship removed";
});

export const addSourceRecordAction = adminAction(async ({ ctx }, fd) => {
  await addSourceRecord(ctx, {
    productId: req(fd, "productId"),
    variantId: str(fd, "variantId"),
    sourceId: req(fd, "sourceId"),
    sourceProductIdentifier: str(fd, "sourceProductIdentifier"),
    sourceUrl: str(fd, "sourceUrl"),
    retrievedAt: str(fd, "retrievedAt"),
    notes: str(fd, "notes"),
  });
  return "Source recorded";
});

export const removeSourceRecordAction = adminAction(async ({ ctx }, fd) => {
  await removeSourceRecord(ctx, req(fd, "id"));
  return "Source record removed";
});

export const addLinkAction = adminAction(async ({ ctx }, fd) => {
  await addProductLink(ctx, {
    productId: req(fd, "productId"),
    linkType: req(fd, "linkType") as "official",
    url: req(fd, "url"),
    sourceId: str(fd, "sourceId"),
  });
  return "Link added";
});

export const removeLinkAction = adminAction(async ({ ctx }, fd) => {
  await removeProductLink(ctx, req(fd, "id"));
  return "Link removed";
});
