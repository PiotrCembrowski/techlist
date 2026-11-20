import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { retailers } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import {
  countryCodeSchema,
  currencyCodeSchema,
  httpsUrlSchema,
  slugify,
  slugSchema,
} from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import { NotFoundError, parseOrThrow, rethrowDbError } from "@/modules/_shared/errors";
import { onlyProvided } from "@/modules/_shared/patch";

export type Retailer = typeof retailers.$inferSelect;

/** Exact host names only (no wildcards, schemes or paths) — see D42. */
const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
    "Enter a host name like shop.example.com",
  );

const retailerBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  websiteUrl: httpsUrlSchema,
  allowedRedirectHosts: z.array(hostSchema).max(20).default([]),
  logoImageKey: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  countryCode: countryCodeSchema,
  supportedCurrencies: z.array(currencyCodeSchema).min(1, "Add at least one currency").max(10),
  affiliateNetwork: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
  isActive: z.boolean().default(true),
  isDemo: z.boolean().default(false),
});

export const retailerUpdateSchema = retailerBaseSchema.partial();

export async function createRetailer(
  ctx: ServiceContext,
  input: z.input<typeof retailerBaseSchema>,
): Promise<Retailer> {
  const data = parseOrThrow(retailerBaseSchema, input, "Invalid retailer");
  const slug = data.slug ?? slugify(data.name);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [row] = await tx
        .insert(retailers)
        .values({
          ...data,
          slug,
          allowedRedirectHosts: [...new Set(data.allowedRedirectHosts)],
          supportedCurrencies: [...new Set(data.supportedCurrencies)],
        })
        .returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "retailer",
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

export async function updateRetailer(
  ctx: ServiceContext,
  id: string,
  patch: z.input<typeof retailerUpdateSchema>,
): Promise<Retailer> {
  const data = onlyProvided(parseOrThrow(retailerUpdateSchema, patch, "Invalid retailer"), patch);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [before] = await tx.select().from(retailers).where(eq(retailers.id, id)).for("update");
      if (!before) throw new NotFoundError("Retailer", id);
      if (Object.keys(data).length === 0) return before;
      const [row] = await tx.update(retailers).set(data).where(eq(retailers.id, id)).returning();
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "retailer",
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

export async function listRetailers(db: DbOrTx): Promise<Retailer[]> {
  return db.select().from(retailers).orderBy(asc(retailers.name)).limit(500);
}

export async function getRetailer(db: DbOrTx, id: string): Promise<Retailer | null> {
  const [row] = await db.select().from(retailers).where(eq(retailers.id, id)).limit(1);
  return row ?? null;
}
