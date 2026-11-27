import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { products } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { PostgresRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { ValidationError } from "@/modules/_shared/errors";
import { createReviewItem } from "@/modules/review-queue/service";
import { getEffectiveDefinitions } from "@/modules/specifications/service";

/** SPEC §9.7 / §13: the public correction form is rate limited per client address. */
export const CORRECTION_LIMIT = 5;
export const CORRECTION_WINDOW_SECONDS = 60 * 60;

export const correctionSchema = z.object({
  productId: z.uuid(),
  /** Optional: which specification the correction is about. */
  key: z
    .string()
    .trim()
    .max(64)
    .transform((v) => v || null),
  value: z
    .string()
    .trim()
    .min(1, "Enter the correct value")
    .max(500, "Keep it under 500 characters"),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === "https:" || u.protocol === "http:";
      } catch {
        return false;
      }
    }, "Enter the full address of the page that shows the correct value"),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => v || null)
    .pipe(z.email("Enter a valid email address or leave it empty").nullable()),
});

export type CorrectionResult = { ok: true } | { ok: false; reason: "rate_limited" };

/**
 * Stores a reader's correction as a `correction` review item. No account is needed; nothing on
 * the site changes until an editor approves it. A filled honeypot field is treated as a bot:
 * the caller is told "thanks" but nothing is stored.
 */
export async function submitCorrection(
  db: DbOrTx,
  input: z.input<typeof correctionSchema> & { honeypot?: string | null },
  clientAddress: string,
): Promise<CorrectionResult> {
  if (input.honeypot && input.honeypot.trim() !== "") return { ok: true };
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      "Check the highlighted fields",
      parsed.error.issues.map((i) => ({ path: String(i.path[0]), message: i.message })),
    );
  }
  const d = parsed.data;
  const limit = await new PostgresRateLimiter(db).consume(
    rateLimitKey("correction", clientAddress),
    CORRECTION_LIMIT,
    CORRECTION_WINDOW_SECONDS,
  );
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };

  const [product] = await db
    .select({ id: products.id, categoryId: products.categoryId, name: products.name })
    .from(products)
    .where(and(eq(products.id, d.productId), eq(products.status, "published")));
  if (!product) throw new ValidationError("This product cannot be corrected");
  if (d.key) {
    const defs = await getEffectiveDefinitions(db, product.categoryId);
    if (!defs.some((x) => x.key === d.key && x.isPublic)) {
      throw new ValidationError("Choose a specification from the list", [
        { path: "key", message: "Unknown specification" },
      ]);
    }
  }
  await createReviewItem(db, {
    itemType: "correction",
    entityType: "product",
    entityId: product.id,
    createdBy: null,
    payload: {
      productId: product.id,
      name: product.name,
      key: d.key,
      value: d.value,
      sourceUrl: d.sourceUrl,
      email: d.email,
    },
  });
  return { ok: true };
}
