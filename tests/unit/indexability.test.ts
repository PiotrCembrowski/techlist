import { describe, expect, it } from "vitest";
import { getIndexability, requiredCoverage } from "@/modules/seo/indexability";

const product = {
  kind: "product" as const,
  publicationStatus: "published",
  isDemo: false,
  brandActive: true,
  verificationStatus: "verified",
  requiredTotal: 10,
  requiredPresent: 6,
};

describe("product indexability", () => {
  it("is indexable when published, real, verified or partially verified, with ≥ 60 % core specs", () => {
    expect(getIndexability(product)).toEqual({ index: true, follow: true, reason: null });
    expect(getIndexability({ ...product, verificationStatus: "partially_verified" }).index).toBe(
      true,
    );
    expect(getIndexability({ ...product, requiredTotal: 0, requiredPresent: 0 }).index).toBe(true);
  });
  it.each([
    [{ publicationStatus: "draft" }, "not published"],
    [{ publicationStatus: "archived" }, "not published"],
    [{ brandActive: false }, "not published"],
    [{ isDemo: true }, "demo record"],
    [{ verificationStatus: "needs_review" }, "not verified"],
    [{ verificationStatus: "draft" }, "not verified"],
    [{ verificationStatus: "rejected" }, "not verified"],
    [{ requiredPresent: 5 }, "too few core specifications"],
  ])("is not indexable when %o", (patch, reason) => {
    const r = getIndexability({ ...product, ...patch });
    expect(r.index).toBe(false);
    expect(r.reason).toBe(reason);
  });
  it("demo and unpublished products are also nofollow", () => {
    expect(getIndexability({ ...product, isDemo: true }).follow).toBe(false);
    expect(getIndexability({ ...product, verificationStatus: "draft" }).follow).toBe(true);
  });
  it("computes coverage", () => {
    expect(requiredCoverage(3, 5)).toBe(0.6);
    expect(requiredCoverage(0, 0)).toBe(1);
  });
});

describe("other pages", () => {
  it("categories need an indexable product and no filters", () => {
    expect(
      getIndexability({ kind: "category", isActive: true, filtered: false, indexableProducts: 1 })
        .index,
    ).toBe(true);
    expect(
      getIndexability({ kind: "category", isActive: true, filtered: false, indexableProducts: 0 })
        .reason,
    ).toBe("no indexable products");
    const filtered = getIndexability({
      kind: "category",
      isActive: true,
      filtered: true,
      indexableProducts: 5,
    });
    expect(filtered).toEqual({ index: false, follow: true, reason: "filtered view" });
  });
  it("comparisons need every product indexable and the canonical order", () => {
    expect(
      getIndexability({ kind: "comparison", productsIndexable: [true, true], canonicalOrder: true })
        .index,
    ).toBe(true);
    expect(
      getIndexability({
        kind: "comparison",
        productsIndexable: [true, false],
        canonicalOrder: true,
      }).index,
    ).toBe(false);
    expect(
      getIndexability({
        kind: "comparison",
        productsIndexable: [true, true],
        canonicalOrder: false,
      }).reason,
    ).toBe("not in canonical order");
    expect(
      getIndexability({ kind: "comparison", productsIndexable: [true], canonicalOrder: true })
        .index,
    ).toBe(false);
  });
  it("brands, guides, listings, content and utility pages", () => {
    expect(
      getIndexability({ kind: "brand", isActive: true, isDemo: false, indexableProducts: 2 }).index,
    ).toBe(true);
    expect(
      getIndexability({ kind: "brand", isActive: true, isDemo: true, indexableProducts: 2 }).index,
    ).toBe(false);
    expect(
      getIndexability({ kind: "brand", isActive: true, isDemo: false, indexableProducts: 0 }).index,
    ).toBe(false);
    expect(
      getIndexability({ kind: "guide", publicationStatus: "published", isDemo: false }).index,
    ).toBe(true);
    expect(
      getIndexability({ kind: "guide", publicationStatus: "published", isDemo: true }).index,
    ).toBe(false);
    expect(getIndexability({ kind: "listing", filtered: false, itemCount: 0 }).reason).toBe(
      "empty page",
    );
    expect(getIndexability({ kind: "listing", filtered: true, itemCount: 10 }).index).toBe(false);
    expect(getIndexability({ kind: "content" }).index).toBe(true);
    expect(getIndexability({ kind: "utility" })).toEqual({
      index: false,
      follow: true,
      reason: "utility page",
    });
  });
});
