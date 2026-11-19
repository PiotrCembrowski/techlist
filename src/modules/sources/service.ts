import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { sources } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { optionalText } from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import { parseOrThrow, rethrowDbError } from "@/modules/_shared/errors";

export type Source = typeof sources.$inferSelect;

export const sourceInputSchema = z.object({
  sourceName: z.string().trim().min(1).max(200),
  sourceType: z.enum(sources.sourceType.enumValues),
  sourceUrl: z
    .url()
    .nullish()
    .transform((v) => v ?? null),
  providerName: optionalText(200),
  licenseType: optionalText(120),
  licenseNotes: optionalText(2000),
  accessMethod: optionalText(120),
  retrievedAt: z.coerce
    .date()
    .nullish()
    .transform((v) => v ?? null),
  attributionRequired: z.boolean().default(false),
  usagePermitted: z.boolean().default(false),
  isDemo: z.boolean().default(false),
});

export async function createSource(
  ctx: ServiceContext,
  input: z.input<typeof sourceInputSchema>,
): Promise<Source> {
  const data = parseOrThrow(sourceInputSchema, input, "Invalid source");
  try {
    return await inTransaction(ctx, async (tx) => {
      const [row] = await tx.insert(sources).values(data).returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "source",
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

export async function getSourceById(db: DbOrTx, id: string): Promise<Source | null> {
  const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  return row ?? null;
}

export async function getSourceByName(db: DbOrTx, name: string): Promise<Source | null> {
  const [row] = await db
    .select()
    .from(sources)
    .where(sql`lower(${sources.sourceName}) = lower(${name})`)
    .limit(1);
  return row ?? null;
}
