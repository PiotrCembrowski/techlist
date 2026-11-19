import { asc, eq, sql } from "drizzle-orm";
import { categories } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { slugify } from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import { clampLimit, inTransaction, type ServiceContext, type Tx } from "@/modules/_shared/context";
import {
  ConflictError,
  NotFoundError,
  parseOrThrow,
  rethrowDbError,
  ValidationError,
} from "@/modules/_shared/errors";
import { onlyProvided } from "@/modules/_shared/patch";
import { recordSlugChange } from "@/modules/slugs/service";
import {
  categoryInputSchema,
  categoryUpdateSchema,
  type CategoryInput,
  type CategoryUpdate,
} from "./schema";

export type Category = typeof categories.$inferSelect;

/** Max depth of the category tree; guards recursive queries against corrupted data. */
export const MAX_CATEGORY_DEPTH = 8;

/** Ancestor chain, root first, ending with the category itself. One recursive query. */
export async function getCategoryAncestors(
  db: DbOrTx,
  categoryId: string,
): Promise<(Category & { depth: number })[]> {
  const rows = await db.execute<{ id: string; depth: number }>(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, 0 AS depth FROM categories WHERE id = ${categoryId}
      UNION ALL
      SELECT c.id, c.parent_id, chain.depth + 1 FROM categories c JOIN chain ON c.id = chain.parent_id
      WHERE chain.depth < ${MAX_CATEGORY_DEPTH}
    )
    SELECT id, depth FROM chain`);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const full = await db
    .select()
    .from(categories)
    .where(sql`${categories.id} = ANY(${sql.param(ids)}::uuid[])`);
  const depth = new Map(rows.map((r) => [r.id, Number(r.depth)]));
  return full.map((c) => ({ ...c, depth: depth.get(c.id)! })).sort((a, b) => b.depth - a.depth);
}

/** All descendant ids (excluding the category itself). */
export async function getCategoryDescendantIds(db: DbOrTx, categoryId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id, 0 AS depth FROM categories WHERE parent_id = ${categoryId}
      UNION ALL
      SELECT c.id, tree.depth + 1 FROM categories c JOIN tree ON c.parent_id = tree.id
      WHERE tree.depth < ${MAX_CATEGORY_DEPTH}
    )
    SELECT id FROM tree`);
  return rows.map((r) => r.id);
}

export async function getTopLevelCategory(
  db: DbOrTx,
  categoryId: string,
): Promise<Category | null> {
  const chain = await getCategoryAncestors(db, categoryId);
  return chain[0] ?? null;
}

async function assertValidParent(tx: Tx, categoryId: string | null, parentId: string | null) {
  if (!parentId) return;
  const [parent] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, parentId));
  if (!parent) throw new NotFoundError("Parent category", parentId);
  if (!categoryId) return;
  if (parentId === categoryId) throw new ValidationError("A category cannot be its own parent");
  const descendants = await getCategoryDescendantIds(tx, categoryId);
  if (descendants.includes(parentId))
    throw new ValidationError("Moving a category under its own descendant would create a cycle");
  const newChain = await getCategoryAncestors(tx, parentId);
  if (newChain.length + 1 > MAX_CATEGORY_DEPTH)
    throw new ValidationError(`Categories may be at most ${MAX_CATEGORY_DEPTH} levels deep`);

  // Specification keys must stay unique across the new inheritance chain.
  const clash = await tx.execute<{ key: string }>(sql`
    SELECT d.key FROM specification_definitions d
    WHERE d.category_id = ANY(${sql.param(newChain.map((c) => c.id))}::uuid[])
    INTERSECT
    SELECT d.key FROM specification_definitions d
    WHERE d.category_id = ANY(${sql.param([categoryId, ...descendants])}::uuid[])
    LIMIT 5`);
  if (clash.length > 0) {
    throw new ConflictError(
      `Specification keys would clash with the new parent chain: ${clash.map((r) => r.key).join(", ")}`,
    );
  }
}

export async function createCategory(ctx: ServiceContext, input: CategoryInput): Promise<Category> {
  const data = parseOrThrow(categoryInputSchema, input, "Invalid category");
  const slug = data.slug ?? slugify(data.name);
  try {
    return await inTransaction(ctx, async (tx) => {
      await assertValidParent(tx, null, data.parentId);
      const [row] = await tx
        .insert(categories)
        .values({ ...data, slug })
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "category",
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

export async function updateCategory(
  ctx: ServiceContext,
  id: string,
  patch: CategoryUpdate,
): Promise<Category> {
  const data = onlyProvided(parseOrThrow(categoryUpdateSchema, patch, "Invalid category"), patch);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .for("update");
      if (!before) throw new NotFoundError("Category", id);
      if (data.parentId !== undefined && data.parentId !== before.parentId)
        await assertValidParent(tx, id, data.parentId);
      const [row] = await tx.update(categories).set(data).where(eq(categories.id, id)).returning();
      if (data.slug && data.slug !== before.slug)
        await recordSlugChange(tx, "category", before.slug, data.slug);
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "category",
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

export async function getCategoryBySlug(db: DbOrTx, slug: string): Promise<Category | null> {
  const [row] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  return row ?? null;
}

export async function listCategories(
  db: DbOrTx,
  opts: { limit?: number; parentId?: string | null } = {},
) {
  const q = db.select().from(categories);
  const filtered =
    opts.parentId === undefined
      ? q
      : q.where(
          opts.parentId === null
            ? sql`${categories.parentId} IS NULL`
            : eq(categories.parentId, opts.parentId),
        );
  return filtered
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .limit(clampLimit(opts.limit, 100));
}
