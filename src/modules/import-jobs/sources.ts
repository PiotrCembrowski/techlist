import { eq } from "drizzle-orm";
import { sources } from "@/db/schema";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import type { ProviderAdapter } from "@/modules/providers/core/types";

export type SourceRow = typeof sources.$inferSelect;

/**
 * The `sources` row a provider's data is attributed to (one per provider, `provider_key`).
 * Created on first use with the adapter's licence details and `usage_permitted = false`: an
 * admin confirms the licence on the Sources page before anything is imported (rule 2.1.9).
 */
export async function ensureProviderSource(
  ctx: ServiceContext,
  adapter: ProviderAdapter,
): Promise<SourceRow> {
  return inTransaction(ctx, async (tx) => {
    const [existing] = await tx.select().from(sources).where(eq(sources.providerKey, adapter.key));
    if (existing) return existing;
    const [row] = await tx
      .insert(sources)
      .values({
        sourceName: adapter.displayName,
        sourceType: "licensed_provider",
        providerKey: adapter.key,
        providerName: adapter.displayName,
        sourceUrl: adapter.licence.url,
        licenseType: adapter.licence.name,
        licenseNotes: adapter.licence.attribution,
        accessMethod: "API",
        attributionRequired: adapter.licence.attributionRequired,
        usagePermitted: false,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const [again] = await tx.select().from(sources).where(eq(sources.providerKey, adapter.key));
      return again!;
    }
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "source",
      entityId: row.id,
      action: "create",
      next: row,
    });
    return row;
  });
}
