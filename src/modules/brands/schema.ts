import { z } from "zod";
import { countryCodeSchema, httpsUrlSchema, optionalText, slugSchema } from "@/lib/validation";

const aliases = z
  .array(z.string().trim().min(1).max(120))
  .max(50)
  .default([])
  .transform((list) => [...new Map(list.map((a) => [a.toLowerCase(), a])).values()]);

export const brandInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  description: optionalText(5000),
  officialWebsiteUrl: httpsUrlSchema.nullish().transform((v) => v ?? null),
  logoImageKey: optionalText(500),
  countryOfOrigin: countryCodeSchema.nullish().transform((v) => v ?? null),
  aliases,
  isActive: z.boolean().default(true),
  isDemo: z.boolean().default(false),
});

export const brandUpdateSchema = brandInputSchema.partial().extend({ aliases: aliases.optional() });

export type BrandInput = z.input<typeof brandInputSchema>;
export type BrandUpdate = z.input<typeof brandUpdateSchema>;
