import { z } from "zod";
import { optionalText, productSlugSchema } from "@/lib/validation";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "Not a real date")
  .nullish()
  .transform((v) => v ?? null);

const aliases = z
  .array(z.string().trim().min(1).max(160))
  .max(50)
  .transform((list) => [...new Map(list.map((a) => [a.toLowerCase(), a])).values()]);

const identifier = z
  .string()
  .trim()
  .max(80)
  .nullish()
  .transform((v) => (v ? v : null));

const productBaseSchema = z.object({
  brandId: z.uuid(),
  categoryId: z.uuid(),
  familyId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  name: z.string().trim().min(1).max(200),
  slug: productSlugSchema.optional(),
  modelName: optionalText(200),
  modelNumber: identifier,
  manufacturerPartNumber: identifier,
  aliases: aliases.default([]),
  description: optionalText(20000),
  shortDescription: optionalText(300),
  releaseDate: isoDate,
  announcedDate: isoDate,
  discontinuedDate: isoDate,
  productStatus: z.enum(["announced", "active", "discontinued", "unknown"]).default("unknown"),
  isFeatured: z.boolean().default(false),
  isDemo: z.boolean().default(false),
  seoTitle: optionalText(160),
  seoDescription: optionalText(320),
});

export interface ProductDates {
  releaseDate?: string | null;
  announcedDate?: string | null;
  discontinuedDate?: string | null;
}

/** Returns an error message when the dates are out of order, else null. */
export function checkProductDates(p: ProductDates): string | null {
  if (p.announcedDate && p.releaseDate && p.announcedDate > p.releaseDate)
    return "Announced date must not be after the release date";
  if (p.discontinuedDate && p.releaseDate && p.releaseDate > p.discontinuedDate)
    return "Discontinued date must not be before the release date";
  return null;
}

export const productInputSchema = productBaseSchema.superRefine((p, ctx) => {
  const msg = checkProductDates(p);
  if (msg) ctx.addIssue({ code: "custom", message: msg, path: ["releaseDate"] });
});

/** For updates; date ordering is re-checked against the stored row in the service. */
export const productUpdateSchema = productBaseSchema
  .partial()
  .extend({ aliases: aliases.optional() });

export type ProductInput = z.input<typeof productInputSchema>;
export type ProductUpdate = z.input<typeof productUpdateSchema>;
