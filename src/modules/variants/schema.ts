import { z } from "zod";
import { CATALOG_STATUSES } from "@/modules/products/status";
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
  /**
   * Only `published` variants are public (and only on published products). Variants added by an
   * editor or a CSV import default to published, as before; provider imports pass needs_review.
   */
  status: z.enum(CATALOG_STATUSES).default("published"),
});

export const variantUpdateSchema = variantBaseSchema.partial();

export type VariantInput = z.input<typeof variantBaseSchema>;
export type VariantUpdate = z.input<typeof variantUpdateSchema>;
