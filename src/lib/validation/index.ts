import { z } from "zod";

/** Lowercase a-z0-9 segments joined by single hyphens. The one slug schema used everywhere. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(SLUG_PATTERN, "Slug must be lowercase letters, digits and single hyphens");

/** Product slugs may not contain "-vs-" (reserved for comparison URLs). */
export const productSlugSchema = slugSchema.refine((s) => !s.includes("-vs-"), {
  message: 'Product slugs may not contain "-vs-" (reserved for comparison URLs)',
});

export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "Country code must be ISO 3166-1 alpha-2 (e.g. PL)");

/** Market selector value: a country code, or ALL. */
export const marketSchema = z.union([z.literal("ALL"), countryCodeSchema]);

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Currency code must be ISO 4217 (e.g. PLN)");

export const httpsUrlSchema = z
  .url()
  .refine((u) => u.startsWith("https://"), { message: "URL must use https" });

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish()
    .transform((v) => v ?? null);

/** Turn arbitrary text into a slug candidate ("Vanta 14 (2026)" -> "vanta-14-2026"). */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

/** GS1 check digit for a GTIN body (all digits except the last). */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new Error("GTIN body must be digits");
  let sum = 0;
  // Weights alternate 3,1,3,1... starting from the digit nearest the check digit.
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(body[i]) * w;
  }
  return (10 - (sum % 10)) % 10;
}

/** GS1 check digit validation for GTIN-8/12/13/14. */
export function isValidGtin(value: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;
  return gtinCheckDigit(value.slice(0, -1)) === Number(value.at(-1));
}

export const gtinSchema = z
  .string()
  .trim()
  .refine(isValidGtin, { message: "Invalid GTIN (length or check digit)" });

export const uuidSchema = z.uuid();
