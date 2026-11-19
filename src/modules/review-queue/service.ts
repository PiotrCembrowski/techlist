import { reviewItems } from "@/db/schema";
import type { Tx } from "@/modules/_shared/context";

type NewReviewItem = typeof reviewItems.$inferInsert;

/** Queue an item for human review (the verification queue UI arrives in Stage 6B). */
export async function createReviewItem(
  tx: Tx,
  item: Pick<NewReviewItem, "itemType" | "entityType" | "entityId" | "payload" | "createdBy">,
) {
  const [row] = await tx.insert(reviewItems).values(item).returning();
  return row!;
}
