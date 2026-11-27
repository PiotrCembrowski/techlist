/**
 * Identifier and name normalisation for matching (DECISIONS D79). These functions only clean
 * representation (case, spacing, dash variants, accents); they never guess missing parts.
 */

const DASHES = /[‐‑‒–—―−]/g;
const TRADEMARKS = /[™®©℠]/g;

function clean(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  // Trademark signs go first: NFKC would turn ™ into the letters "TM".
  const s = String(raw).replace(TRADEMARKS, "").normalize("NFKC").replace(DASHES, "-").trim();
  return s === "" ? null : s;
}

/** Display text: trimmed, single spaces, trademark signs removed. */
export function normalizeText(raw: string | null | undefined, maxLength = 300): string | null {
  const s = clean(raw);
  return s ? s.replace(/\s+/g, " ").slice(0, maxLength) : null;
}

/**
 * Manufacturer part number for exact matching: upper case, no whitespace, unified dashes.
 * Punctuation is kept (MU7A3LL/A and MU7A3LL-A are different part numbers).
 */
export function normalizeMpn(raw: string | null | undefined): string | null {
  const s = clean(raw);
  if (!s) return null;
  const v = s.toUpperCase().replace(/\s+/g, "");
  return v.length >= 2 && v.length <= 80 ? v : null;
}

/**
 * Model identifier key: upper case letters and digits only, so "SM-S928B", "SM S928B" and
 * "sm-s928b" compare equal (same rule as the CSV import's model-number match).
 */
export function modelKey(raw: string | null | undefined): string | null {
  const s = clean(raw);
  if (!s) return null;
  const v = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return v.length >= 2 ? v : null;
}

const CORPORATE_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "llc",
  "gmbh",
  "co",
  "corp",
  "corporation",
  "company",
  "plc",
  "ag",
  "sa",
  "bv",
  "kk",
  "oy",
  "ab",
  "spa",
  "srl",
  "electronics",
]);

function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Brand key: accents and case folded, punctuation removed, trailing corporate suffixes dropped
 * ("Samsung Electronics Co., Ltd." → "samsung"). Never empty for a non-empty input: if only
 * suffix words remain, the folded input is returned.
 */
export function brandKey(raw: string | null | undefined): string | null {
  const s = clean(raw);
  if (!s) return null;
  const words = fold(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const kept = [...words];
  while (kept.length > 1 && CORPORATE_SUFFIXES.has(kept.at(-1)!)) kept.pop();
  return (kept.length ? kept : words).join(" ") || null;
}

/**
 * Product name key for suggestions only (never an automatic merge): folded, punctuation as
 * spaces, the brand prefix removed.
 */
export function nameKey(name: string | null | undefined, brand?: string | null): string | null {
  const s = clean(name);
  if (!s) return null;
  let v = fold(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const b = brand ? brandKey(brand) : null;
  if (b && v.startsWith(`${b} `)) v = v.slice(b.length + 1);
  return v || null;
}

/**
 * Release date: only full ISO dates are accepted (YYYY-MM-DD, optionally followed by a time).
 * A year or a month alone is NOT turned into a date — that would invent a day.
 */
export function normalizeIsoDate(raw: string | null | undefined): string | null {
  const s = clean(raw);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[1] ? m[1]! : null;
}

/** Plain text from provider HTML or text: tags removed, entities for &, <, >, quotes decoded. */
export function plainText(raw: string | null | undefined, maxLength = 5000): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return s ? s.slice(0, maxLength) : null;
}
