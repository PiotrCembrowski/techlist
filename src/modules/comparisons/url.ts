import { productSlugSchema } from "@/lib/validation";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;
const SEPARATOR = "-vs-";

export type ParsedComparison =
  | { ok: true; slugs: string[]; canonical: string[]; isCanonical: boolean }
  | { ok: false; reason: "too_few" | "too_many" | "invalid_slug" | "duplicate" };

/**
 * Parses "/compare/[a]-vs-[b](-vs-…)". Product slugs can never contain "-vs-" (enforced by Zod
 * and a DB CHECK), so splitting is unambiguous. The canonical form sorts slugs alphabetically.
 */
export function parseComparisonParam(param: string): ParsedComparison {
  const slugs = decodeURIComponent(param).split(SEPARATOR);
  if (slugs.length < MIN_COMPARE) return { ok: false, reason: "too_few" };
  if (slugs.length > MAX_COMPARE) return { ok: false, reason: "too_many" };
  if (slugs.some((s) => !productSlugSchema.safeParse(s).success))
    return { ok: false, reason: "invalid_slug" };
  if (new Set(slugs).size !== slugs.length) return { ok: false, reason: "duplicate" };
  const canonical = canonicalSlugs(slugs);
  return { ok: true, slugs, canonical, isCanonical: canonical.every((s, i) => s === slugs[i]) };
}

export function canonicalSlugs(slugs: string[]): string[] {
  return [...new Set(slugs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** "/compare/a-vs-b" for 2–4 products; "/compare" otherwise (the picker). */
export function comparisonPath(slugs: string[]): string {
  const c = canonicalSlugs(slugs);
  return c.length >= MIN_COMPARE && c.length <= MAX_COMPARE
    ? `/compare/${c.join(SEPARATOR)}`
    : "/compare";
}
