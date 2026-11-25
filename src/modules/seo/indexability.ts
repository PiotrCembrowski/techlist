/**
 * SPEC §12 indexability rules — the single source of truth. Pages, the sitemap and structured
 * data all decide through `getIndexability`; the SQL in ./queries.ts mirrors the product rule
 * (an integration test keeps the two in step).
 */

export const MIN_REQUIRED_COVERAGE = 0.6;

export type IndexablePage =
  | {
      kind: "product";
      /** The single catalogue status; `published` implies an editor verified it (D77). */
      status: string;
      isDemo: boolean;
      brandActive: boolean;
      /** Required (core) specifications of the category, and how many have a product-level value. */
      requiredTotal: number;
      requiredPresent: number;
    }
  | { kind: "category"; isActive: boolean; filtered: boolean; indexableProducts: number }
  | { kind: "brand"; isActive: boolean; isDemo: boolean; indexableProducts: number }
  | { kind: "comparison"; productsIndexable: boolean[]; canonicalOrder: boolean }
  | { kind: "guide"; publicationStatus: string; isDemo: boolean }
  | { kind: "listing"; filtered: boolean; itemCount: number }
  | { kind: "content" }
  | { kind: "utility" };

export interface Indexability {
  index: boolean;
  follow: boolean;
  /** Why a page is not indexed (for tests and debugging). */
  reason: string | null;
}

const yes: Indexability = { index: true, follow: true, reason: null };
const no = (reason: string, follow = true): Indexability => ({ index: false, follow, reason });

export function requiredCoverage(present: number, total: number): number {
  return total === 0 ? 1 : present / total;
}

export function getIndexability(page: IndexablePage): Indexability {
  switch (page.kind) {
    case "product":
      if (page.status !== "published" || !page.brandActive) return no("not published", false);
      if (page.isDemo) return no("demo record", false);
      if (requiredCoverage(page.requiredPresent, page.requiredTotal) < MIN_REQUIRED_COVERAGE)
        return no("too few core specifications");
      return yes;
    case "category":
      if (!page.isActive) return no("inactive", false);
      if (page.filtered) return no("filtered view");
      if (page.indexableProducts < 1) return no("no indexable products");
      return yes;
    case "brand":
      if (!page.isActive) return no("inactive", false);
      if (page.isDemo) return no("demo record", false);
      if (page.indexableProducts < 1) return no("no indexable products");
      return yes;
    case "comparison":
      if (!page.canonicalOrder) return no("not in canonical order");
      if (page.productsIndexable.length < 2 || !page.productsIndexable.every(Boolean))
        return no("contains products that are not indexable");
      return yes;
    case "guide":
      if (page.publicationStatus !== "published") return no("not published", false);
      if (page.isDemo) return no("demo record", false);
      return yes;
    case "listing":
      if (page.filtered) return no("filtered view");
      if (page.itemCount < 1) return no("empty page");
      return yes;
    case "content":
      return yes;
    case "utility":
      return no("utility page");
  }
}
