import { z } from "zod";
import { countryCodeSchema, gtinSchema, optionalText, slugSchema } from "@/lib/validation";

export const variantBaseSchema = z.object({
  variantName: z.string().trim().min(1).max(200),
  variantCode: slugSchema.max(64).optional(),
  manufacturerPartNumber: optionalText(80),
  /** ISO 3166-1 alpha-2 or a two-letter region such as EU; null = global. */
  regionCode: countryCodeSchema.nullish().transform((v) => v ?? null),
  color: optionalText(80),
  memoryConfiguration: optionalText(80),
  storageConfiguration: optionalText(80),
  configurationLabel: optionalText(120),
  barcodeGtin: gtinSchema.nullish().transform((v) => v ?? null),
  sku: optionalText(80),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const variantUpdateSchema = variantBaseSchema.partial();

export type VariantInput = z.input<typeof variantBaseSchema>;
export type VariantUpdate = z.input<typeof variantUpdateSchema>;
