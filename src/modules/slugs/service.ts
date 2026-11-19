import { and, eq } from "drizzle-orm";
import { slugRedirects } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import type { Tx } from "@/modules/_shared/context";

type EntityType = (typeof slugRedirects.$inferInsert)["entityType"];

/**
 * Records old -> new so public routes can 301. Existing redirects that pointed at the old slug are
 * re-pointed (no chains), and a redirect from the new slug is removed (the slug is live again).
 */
export async function recordSlugChange(
  tx: Tx,
  entityType: EntityType,
  oldSlug: string,
  newSlug: string,
) {
  if (oldSlug === newSlug) return;
  // The new slug is live again: drop any redirect away from it first (otherwise re-pointing below
  // would momentarily create a self-redirect, which the CHECK constraint rejects).
  await tx
    .delete(slugRedirects)
    .where(and(eq(slugRedirects.entityType, entityType), eq(slugRedirects.oldSlug, newSlug)));
  await tx
    .update(slugRedirects)
    .set({ newSlug })
    .where(and(eq(slugRedirects.entityType, entityType), eq(slugRedirects.newSlug, oldSlug)));
  await tx
    .insert(slugRedirects)
    .values({ entityType, oldSlug, newSlug })
    .onConflictDoUpdate({
      target: [slugRedirects.entityType, slugRedirects.oldSlug],
      set: { newSlug },
    });
}

export async function resolveSlugRedirect(
  db: DbOrTx,
  entityType: EntityType,
  slug: string,
): Promise<string | null> {
  const [row] = await db
    .select({ newSlug: slugRedirects.newSlug })
    .from(slugRedirects)
    .where(and(eq(slugRedirects.entityType, entityType), eq(slugRedirects.oldSlug, slug)))
    .limit(1);
  return row?.newSlug ?? null;
}
