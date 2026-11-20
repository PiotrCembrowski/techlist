import { formatQuantity } from "@/lib/units";

/** All UI formatting uses one locale for now (English UI at launch, SPEC §1.4). */
export const UI_LOCALE = "en-GB";

/**
 * Prices are always shown in their original currency (no conversion, SPEC §6). The ISO code is
 * shown rather than a symbol, so "$" is never ambiguous between markets.
 */
export function formatPrice(amount: string | number, currency: string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat(UI_LOCALE, { style: "currency", currency, currencyDisplay: "code" })
    .format(n)
    .replace(/ /g, " ");
}

export function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d =
    typeof value === "string"
      ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
      : value;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(UI_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

const regionNames = new Intl.DisplayNames([UI_LOCALE], { type: "region" });

/** "PL" -> "Poland"; "EU" -> "European Union"; unknown codes are returned as-is. */
export function marketName(code: string): string {
  if (code === "ALL") return "All markets";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "3 hours ago", "5 days ago" — used for "Last checked". */
export function formatRelative(from: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export interface SpecValueLike {
  valueText: string | null;
  valueNumeric: number | string | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: string[] | null;
}

export interface SpecDefinitionLike {
  dataType: string;
  canonicalUnit: string | null;
}

/**
 * Display text for a stored specification value. Returns null when there is no value — callers
 * render "Not available", which is visually distinct from a boolean "No".
 */
export function formatSpecValue(
  def: SpecDefinitionLike,
  v: SpecValueLike | null | undefined,
): string | null {
  if (!v) return null;
  if (v.valueBoolean !== null) return v.valueBoolean ? "Yes" : "No";
  if (v.valueNumeric !== null)
    return formatQuantity(Number(v.valueNumeric), def.canonicalUnit, UI_LOCALE);
  if (v.valueDate !== null) return formatDate(v.valueDate);
  if (v.valueJson !== null) return v.valueJson.join(", ");
  return v.valueText;
}
