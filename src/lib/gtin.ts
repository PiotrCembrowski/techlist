import { gtinCheckDigit } from "@/lib/validation";

/**
 * GTIN utilities (GS1). Every GTIN is stored as GTIN-14: GTIN-8, UPC-A (12), EAN-13 and GTIN-14
 * are left-padded with zeros, which keeps the check digit valid. Inputs may contain spaces or
 * hyphens; anything else is rejected rather than guessed.
 */

export type GtinFormat = "GTIN-8" | "UPC-A" | "EAN-13" | "GTIN-14";

export type GtinResult =
  | { ok: true; gtin14: string; format: GtinFormat }
  | { ok: false; reason: "empty" | "not_digits" | "bad_length" | "bad_check_digit" | "all_zero" };

const FORMATS: Record<number, GtinFormat> = {
  8: "GTIN-8",
  12: "UPC-A",
  13: "EAN-13",
  14: "GTIN-14",
};

export function normalizeGtin(raw: string | number | null | undefined): GtinResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "empty" };
  const s = String(raw)
    .trim()
    .replace(/[\s-]+/g, "");
  if (s === "") return { ok: false, reason: "empty" };
  if (!/^\d+$/.test(s)) return { ok: false, reason: "not_digits" };
  const format = FORMATS[s.length];
  if (!format) return { ok: false, reason: "bad_length" };
  if (/^0+$/.test(s)) return { ok: false, reason: "all_zero" };
  if (gtinCheckDigit(s.slice(0, -1)) !== Number(s.at(-1)))
    return { ok: false, reason: "bad_check_digit" };
  return { ok: true, gtin14: s.padStart(14, "0"), format };
}

/** GTIN-14 or null (invalid input). */
export function toGtin14(raw: string | number | null | undefined): string | null {
  const r = normalizeGtin(raw);
  return r.ok ? r.gtin14 : null;
}

/**
 * Shortest standard form for display: EAN-13 when the GTIN-14 starts with 0, GTIN-8 when it
 * starts with six zeros, otherwise the GTIN-14.
 */
export function displayGtin(gtin14: string): string {
  if (/^0{6}\d{8}$/.test(gtin14)) return gtin14.slice(6);
  if (gtin14.startsWith("0")) return gtin14.slice(1);
  return gtin14;
}

/**
 * Splits raw GTIN strings into valid GTIN-14s (deduplicated, in order) and rejected inputs with
 * their reason. Rejected values are kept for the raw record, never silently dropped.
 */
export function partitionGtins(raws: readonly (string | number)[]): {
  valid: string[];
  invalid: { raw: string; reason: string }[];
} {
  const valid: string[] = [];
  const invalid: { raw: string; reason: string }[] = [];
  for (const raw of raws) {
    const r = normalizeGtin(raw);
    if (r.ok) {
      if (!valid.includes(r.gtin14)) valid.push(r.gtin14);
    } else if (r.reason !== "empty") invalid.push({ raw: String(raw), reason: r.reason });
  }
  return { valid, invalid };
}
