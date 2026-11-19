import { asc, eq, sql } from "drizzle-orm";
import { brands } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { slugify } from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import { clampLimit, inTransaction, type ServiceContext } from "@/modules/_shared/context";
import {
  NotFoundError,
  parseOrThrow,
  rethrowDbError,
  ValidationError,
} from "@/modules/_shared/errors";
import { onlyProvided } from "@/modules/_shared/patch";
import { recordSlugChange } from "@/modules/slugs/service";
import { brandInputSchema, brandUpdateSchema, type BrandInput, type BrandUpdate } from "./schema";

export type Brand = typeof brands.$inferSelect;

export async function createBrand(ctx: ServiceContext, input: BrandInput): Promise<Brand> {
  const data = parseOrThrow(brandInputSchema, input, "Invalid brand");
  const slug = data.slug ?? slugify(data.name);
  if (!slug) throw new ValidationError("Cannot derive a slug from the brand name");
  try {
    return await inTransaction(ctx, async (tx) => {
      const [row] = await tx
        .insert(brands)
        .values({ ...data, slug })
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "brand",
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

export async function updateBrand(
  ctx: ServiceContext,
  id: string,
  patch: BrandUpdate,
): Promise<Brand> {
  const data = onlyProvided(parseOrThrow(brandUpdateSchema, patch, "Invalid brand"), patch);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [before] = await tx.select().from(brands).where(eq(brands.id, id)).for("update");
      if (!before) throw new NotFoundError("Brand", id);
      const [row] = await tx.update(brands).set(data).where(eq(brands.id, id)).returning();
      if (data.slug && data.slug !== before.slug)
        await recordSlugChange(tx, "brand", before.slug, data.slug);
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "brand",
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

export async function getBrandById(db: DbOrTx, id: string): Promise<Brand | null> {
  const [row] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  return row ?? null;
}

export async function getBrandBySlug(db: DbOrTx, slug: string): Promise<Brand | null> {
  const [row] = await db.select().from(brands).where(eq(brands.slug, slug)).limit(1);
  return row ?? null;
}

/** Case- and accent-insensitive lookup by name or alias (used by imports). */
export async function findBrandByNameOrAlias(db: DbOrTx, name: string): Promise<Brand | null> {
  const needle = name.trim();
  if (!needle) return null;
  const [row] = await db
    .select()
    .from(brands)
    .where(
      sql`lower(sb_unaccent(${brands.name})) = lower(sb_unaccent(${needle}))
        OR EXISTS (SELECT 1 FROM unnest(${brands.aliases}) AS a WHERE lower(sb_unaccent(a)) = lower(sb_unaccent(${needle})))`,
    )
    .limit(1);
  return row ?? null;
}

export async function listBrands(
  db: DbOrTx,
  opts: { limit?: number; offset?: number } = {},
): Promise<Brand[]> {
  return db
    .select()
    .from(brands)
    .orderBy(asc(brands.name))
    .limit(clampLimit(opts.limit, 50))
    .offset(Math.max(0, opts.offset ?? 0));
}
