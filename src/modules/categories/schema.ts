import { z } from "zod";
import { optionalText, slugSchema } from "@/lib/validation";

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  parentId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  description: optionalText(5000),
  icon: optionalText(64),
  sortOrder: z.number().int().min(0).max(10000).default(0),
  seoTitle: optionalText(160),
  seoDescription: optionalText(320),
  isActive: z.boolean().default(true),
});

export const categoryUpdateSchema = categoryInputSchema.partial();

export type CategoryInput = z.input<typeof categoryInputSchema>;
export type CategoryUpdate = z.input<typeof categoryUpdateSchema>;
