import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { priceHistory, productVariants, retailerOffers, retailers } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { countryCodeSchema, currencyCodeSchema, httpsUrlSchema } from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext, type Tx } from "@/modules/_shared/context";
import {
  NotFoundError,
  parseOrThrow,
  rethrowDbError,
  ValidationError,
} from "@/modules/_shared/errors";
import { onlyProvided } from "@/modules/_shared/patch";
import { createReviewItem } from "@/modules/review-queue/service";
import { validateRedirectTarget } from "./redirect";

export type RetailerOffer = typeof retailerOffers.$inferSelect;

/** Money as a numeric(14,4) string; never a float in the database. */
export const moneySchema = z
  .union([z.number(), z.string().trim()])
  .transform((v) => (typeof v === "number" ? v : Number(v.replace(/\s/g, ""))))
  .refine(
    (n) => Number.isFinite(n) && n >= 0 && n < 1e10,
    "Must be a non-negative amount below 10,000,000,000",
  )
  .transform((n) => n.toFixed(4));

const positiveMoney = moneySchema.refine((s) => Number(s) > 0, "Price must be greater than 0");

const offerBaseSchema = z.object({
  productId: z.uuid(),
  variantId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  retailerId: z.uuid(),
  retailerProductId: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  marketCountryCode: countryCodeSchema,
  productUrl: httpsUrlSchema,
  affiliateUrl: httpsUrlSchema.nullish().transform((v) => v ?? null),
  currency: currencyCodeSchema,
  priceAmount: positiveMoney,
  originalPriceAmount: positiveMoney.nullish().transform((v) => v ?? null),
  shippingCost: moneySchema.nullish().transform((v) => v ?? null),
  availabilityStatus: z
    .enum(["in_stock", "out_of_stock", "preorder", "unknown"])
    .default("unknown"),
  condition: z.enum(["new", "used", "refurbished"]).default("new"),
  sourceId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  lastCheckedAt: z.coerce.date().optional(),
  expiresAt: z.coerce
    .date()
    .nullish()
    .transform((v) => v ?? null),
  isActive: z.boolean().default(true),
  isDemo: z.boolean().default(false),
});

export const offerUpdateSchema = offerBaseSchema
  .omit({ productId: true, retailerId: true })
  .partial();

export type OfferInput = z.input<typeof offerBaseSchema>;
export type OfferUpdate = z.input<typeof offerUpdateSchema>;

/** Median of a list (null when empty). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** SPEC §5.2: suspicious = deviates more than `deviation` (default 50%) from the median of the others. */
export function isSuspiciousPrice(price: number, others: number[], deviation: number): boolean {
  const m = median(others);
  if (m === null || m <= 0) return false;
  return Math.abs(price - m) / m > deviation;
}

async function assertRetailerAndUrls(
  tx: Tx,
  retailerId: string,
  data: { currency: string; productUrl: string; affiliateUrl: string | null },
) {
  const [r] = await tx.select().from(retailers).where(eq(retailers.id, retailerId));
  if (!r) throw new NotFoundError("Retailer", retailerId);
  if (!r.supportedCurrencies.includes(data.currency)) {
    throw new ValidationError(
      `${r.name} does not sell in ${data.currency} (supported: ${r.supportedCurrencies.join(", ")})`,
    );
  }
  // Refuse links /go/ would refuse anyway: catch the mistake when the offer is entered.
  for (const [field, url] of [
    ["productUrl", data.productUrl],
    ["affiliateUrl", data.affiliateUrl],
  ] as const) {
    if (!url) continue;
    const v = validateRedirectTarget(url, r.allowedRedirectHosts);
    if (!v.ok) {
      throw new ValidationError(
        v.reason === "host_not_allowed"
          ? `${field}: host is not in ${r.name}'s allowed redirect hosts`
          : `${field}: must be a plain https URL without credentials or custom port`,
        [{ path: field, message: v.reason }],
      );
    }
  }
  return r;
}

/** Appends a price_history row (application code never updates or deletes history). */
async function appendPriceHistory(tx: Tx, o: RetailerOffer) {
  await tx.insert(priceHistory).values({
    offerId: o.id,
    productId: o.productId,
    variantId: o.variantId,
    retailerId: o.retailerId,
    currency: o.currency,
    priceAmount: o.priceAmount,
    recordedAt: o.lastCheckedAt,
    sourceId: o.sourceId,
  });
}

/** Flags prices far from the product's median current price in the same currency. */
async function checkSuspicious(tx: Tx, ctx: ServiceContext, o: RetailerOffer): Promise<boolean> {
  const env = getEnv();
  const others = await tx
    .select({ price: retailerOffers.priceAmount })
    .from(retailerOffers)
    .where(
      and(
        eq(retailerOffers.productId, o.productId),
        eq(retailerOffers.currency, o.currency),
        eq(retailerOffers.isActive, true),
        ne(retailerOffers.id, o.id),
        sql`(${retailerOffers.expiresAt} IS NULL OR ${retailerOffers.expiresAt} > now())`,
        sql`${retailerOffers.lastCheckedAt} >= now() - make_interval(hours => ${env.OFFER_STALE_HOURS})`,
      ),
    )
    .limit(200);
  const prices = others.map((x) => Number(x.price));
  if (!isSuspiciousPrice(Number(o.priceAmount), prices, env.SUSPICIOUS_PRICE_DEVIATION))
    return false;
  await createReviewItem(tx, {
    itemType: "suspicious_price",
    entityType: "retailer_offer",
    entityId: o.id,
    createdBy: ctx.actorId,
    payload: {
      productId: o.productId,
      currency: o.currency,
      price: o.priceAmount,
      median: median(prices),
      compared: prices.length,
    },
  });
  return true;
}

export async function createRetailerOffer(
  ctx: ServiceContext,
  input: OfferInput,
): Promise<{ offer: RetailerOffer; suspicious: boolean }> {
  const data = parseOrThrow(offerBaseSchema, input, "Invalid offer");
  try {
    return await inTransaction(ctx, async (tx) => {
      await assertRetailerAndUrls(tx, data.retailerId, data);
      if (data.variantId) {
        const [v] = await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(
            and(
              eq(productVariants.id, data.variantId),
              eq(productVariants.productId, data.productId),
            ),
          );
        if (!v) throw new ValidationError("The variant does not belong to this product");
      }
      const [offer] = await tx
        .insert(retailerOffers)
        .values({ ...data, lastCheckedAt: data.lastCheckedAt ?? new Date() })
        .returning();
      await appendPriceHistory(tx, offer!);
      const suspicious = await checkSuspicious(tx, ctx, offer!);
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "retailer_offer",
        entityId: offer!.id,
        action: "create",
        next: offer,
      });
      return { offer: offer!, suspicious };
    });
  } catch (e) {
    rethrowDbError(e);
  }
}

export async function updateRetailerOffer(
  ctx: ServiceContext,
  id: string,
  patch: OfferUpdate,
): Promise<{ offer: RetailerOffer; suspicious: boolean }> {
  const data = onlyProvided(parseOrThrow(offerUpdateSchema, patch, "Invalid offer"), patch);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(retailerOffers)
        .where(eq(retailerOffers.id, id))
        .for("update");
      if (!before) throw new NotFoundError("Offer", id);
      if (Object.keys(data).length === 0) return { offer: before, suspicious: false };
      const merged = { ...before, ...data };
      await assertRetailerAndUrls(tx, before.retailerId, merged);
      const [offer] = await tx
        .update(retailerOffers)
        .set(data)
        .where(eq(retailerOffers.id, id))
        .returning();
      const priceChanged =
        Number(before.priceAmount) !== Number(offer!.priceAmount) ||
        before.currency !== offer!.currency;
      let suspicious = false;
      if (priceChanged) {
        await appendPriceHistory(tx, offer!);
        suspicious = await checkSuspicious(tx, ctx, offer!);
      }
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "retailer_offer",
        entityId: id,
        action: "update",
        previous: before,
        next: offer,
      });
      return { offer: offer!, suspicious };
    });
  } catch (e) {
    rethrowDbError(e);
  }
}

/** "Mark as checked now" (SPEC §9.5): refreshes freshness without changing the price. */
export async function markOfferChecked(
  ctx: ServiceContext,
  id: string,
  at: Date = new Date(),
): Promise<RetailerOffer> {
  return (await updateRetailerOffer(ctx, id, { lastCheckedAt: at })).offer;
}

export async function getPriceHistory(db: DbOrTx, offerId: string, limit = 100) {
  return db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.offerId, offerId))
    .orderBy(desc(priceHistory.recordedAt))
    .limit(Math.min(limit, 500));
}
