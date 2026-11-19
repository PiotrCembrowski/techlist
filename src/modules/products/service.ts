import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import { brands, categories, productFamilies, products } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { slugify } from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import {
  clampLimit,
  inTransaction,
  MAX_PAGE_SIZE,
  type ServiceContext,
  type Tx,
} from "@/modules/_shared/context";
import {
  InvalidStateError,
  NotFoundError,
  parseOrThrow,
  rethrowDbError,
  ValidationError,
} from "@/modules/_shared/errors";
import { onlyProvided } from "@/modules/_shared/patch";
import { recordSlugChange } from "@/modules/slugs/service";
import {
  checkProductDates,
  productInputSchema,
  productUpdateSchema,
  type ProductInput,
  type ProductUpdate,
} from "./schema";

export type Product = typeof products.$inferSelect;
type VerificationStatus = Product["verificationStatus"];

async function assertReferences(
  tx: Tx,
  p: { brandId: string; categoryId: string; familyId: string | null },
) {
  const [brand] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, p.brandId));
  if (!brand) throw new NotFoundError("Brand", p.brandId);
  const [category] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, p.categoryId));
  if (!category) throw new NotFoundError("Category", p.categoryId);
  if (p.familyId) {
    const [family] = await tx
      .select()
      .from(productFamilies)
      .where(eq(productFamilies.id, p.familyId));
    if (!family) throw new NotFoundError("Product family", p.familyId);
    if (family.brandId !== p.brandId || family.categoryId !== p.categoryId) {
      throw new ValidationError("The product family must belong to the same brand and category");
    }
  }
}

/** New products always start as drafts; use publishProduct() to make them public. */
export async function createProduct(ctx: ServiceContext, input: ProductInput): Promise<Product> {
  const data = parseOrThrow(productInputSchema, input, "Invalid product");
  const slug = data.slug ?? slugify(data.name);
  parseOrThrow(productInputSchema, { ...input, slug }, "Invalid product slug");
  try {
    return await inTransaction(ctx, async (tx) => {
      await assertReferences(tx, data);
      const [row] = await tx
        .insert(products)
        .values({ ...data, slug, publicationStatus: "draft", verificationStatus: "draft" })
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "product",
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

export async function updateProduct(
  ctx: ServiceContext,
  id: string,
  patch: ProductUpdate,
): Promise<Product> {
  const data = onlyProvided(parseOrThrow(productUpdateSchema, patch, "Invalid product"), patch);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
      if (!before) throw new NotFoundError("Product", id);
      if (Object.keys(data).length === 0) return before;
      const merged = { ...before, ...data };
      const dateError = checkProductDates(merged);
      if (dateError) throw new ValidationError(dateError);
      if (data.brandId || data.categoryId || data.familyId !== undefined)
        await assertReferences(tx, merged);
      const [row] = await tx.update(products).set(data).where(eq(products.id, id)).returning();
      if (data.slug && data.slug !== before.slug)
        await recordSlugChange(tx, "product", before.slug, data.slug);
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "product",
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

async function transition(
  ctx: ServiceContext,
  id: string,
  action: string,
  apply: (before: Product) => Partial<typeof products.$inferInsert>,
): Promise<Product> {
  return inTransaction(ctx, async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
    if (!before) throw new NotFoundError("Product", id);
    const [row] = await tx
      .update(products)
      .set(apply(before))
      .where(eq(products.id, id))
      .returning();
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "product",
      entityId: id,
      action,
      previous: before,
      next: row,
    });
    return row!;
  });
}

export function publishProduct(ctx: ServiceContext, id: string): Promise<Product> {
  return transition(ctx, id, "publish", (p) => {
    if (p.publicationStatus === "published")
      throw new InvalidStateError("Product is already published");
    if (p.verificationStatus === "rejected")
      throw new InvalidStateError("Rejected products cannot be published");
    return { publicationStatus: "published" };
  });
}

/** "Delete" in the admin means archive. */
export function archiveProduct(ctx: ServiceContext, id: string): Promise<Product> {
  return transition(ctx, id, "archive", (p) => {
    if (p.publicationStatus === "archived")
      throw new InvalidStateError("Product is already archived");
    return { publicationStatus: "archived", isFeatured: false };
  });
}

export function unpublishProduct(ctx: ServiceContext, id: string): Promise<Product> {
  return transition(ctx, id, "unpublish", (p) => {
    if (p.publicationStatus === "draft") throw new InvalidStateError("Product is already a draft");
    return { publicationStatus: "draft" };
  });
}

const VERIFIED_STATES: VerificationStatus[] = ["verified", "partially_verified"];

export function verifyProduct(
  ctx: ServiceContext,
  id: string,
  status: VerificationStatus,
): Promise<Product> {
  return transition(ctx, id, `verification:${status}`, () => ({
    verificationStatus: status,
    lastVerifiedAt: VERIFIED_STATES.includes(status) ? new Date() : null,
  }));
}

/** Hard delete is only allowed for drafts, and requires explicit confirmation. */
export async function deleteDraftProduct(
  ctx: ServiceContext,
  id: string,
  opts: { confirm: boolean },
): Promise<void> {
  if (!opts.confirm) throw new ValidationError("Deleting a product requires confirmation");
  await inTransaction(ctx, async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
    if (!before) throw new NotFoundError("Product", id);
    if (before.publicationStatus !== "draft")
      throw new InvalidStateError("Only draft products can be deleted; archive it instead");
    await tx.delete(products).where(eq(products.id, id));
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "product",
      entityId: id,
      action: "delete",
      previous: before,
    });
  });
}

export async function getProductById(db: DbOrTx, id: string): Promise<Product | null> {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return row ?? null;
}

/** Public lookup: only published products are returned. */
export async function getPublishedProductBySlug(db: DbOrTx, slug: string) {
  const [row] = await db
    .select({ product: products, brandSlug: brands.slug, brandName: brands.name })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .where(and(eq(products.slug, slug), eq(products.publicationStatus, "published")))
    .limit(1);
  return row ?? null;
}

export interface ListProductsOptions {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  brandId?: string;
  productStatus?: Product["productStatus"];
  /** Defaults to published only. */
  publicationStatus?: Product["publicationStatus"] | "any";
  sort?: "newest" | "name" | "release_date";
}

export async function listProducts(db: DbOrTx, opts: ListProductsOptions = {}) {
  const pageSize = clampLimit(opts.pageSize, 24, MAX_PAGE_SIZE);
  const page = Math.max(1, Math.trunc(opts.page ?? 1));
  const filters: SQL[] = [];
  const pub = opts.publicationStatus ?? "published";
  if (pub !== "any") filters.push(eq(products.publicationStatus, pub));
  if (opts.categoryId) filters.push(eq(products.categoryId, opts.categoryId));
  if (opts.brandId) filters.push(eq(products.brandId, opts.brandId));
  if (opts.productStatus) filters.push(eq(products.productStatus, opts.productStatus));
  const where = filters.length ? and(...filters) : undefined;
  const order =
    opts.sort === "name"
      ? [asc(products.name), asc(products.id)]
      : opts.sort === "release_date"
        ? [desc(products.releaseDate), asc(products.id)]
        : [desc(products.createdAt), asc(products.id)];

  const [items, [total]] = await Promise.all([
    db
      .select()
      .from(products)
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(products).where(where),
  ]);
  return {
    items,
    total: total?.n ?? 0,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil((total?.n ?? 0) / pageSize)),
  };
}
