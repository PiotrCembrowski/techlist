import { describe, expect, it } from "vitest";
import {
  CATALOG_STATUSES,
  canTransition,
  isCatalogStatus,
  transitionAction,
  transitionLabel,
  transitionPatch,
} from "@/modules/products/status";

describe("catalog status transitions (D77)", () => {
  it("only reaches published from draft, needs_review or verified", () => {
    const from = CATALOG_STATUSES.filter((s) => canTransition(s, "published"));
    expect(from.sort()).toEqual(["draft", "needs_review", "verified"]);
  });
  it("never leaves archived except back to draft", () => {
    expect(CATALOG_STATUSES.filter((s) => canTransition("archived", s))).toEqual(["draft"]);
  });
  it("does not allow rejecting a published product (unpublish or archive it)", () => {
    expect(canTransition("published", "rejected")).toBe(false);
    expect(canTransition("published", "verified")).toBe(true);
  });
  it("names actions and buttons by where the product comes from", () => {
    expect(transitionAction("published", "verified")).toBe("unpublish");
    expect(transitionAction("draft", "published")).toBe("verify_and_publish");
    expect(transitionAction("verified", "published")).toBe("publish");
    expect(transitionLabel("draft", "published")).toBe("Verify & publish");
    expect(transitionLabel("verified", "published")).toBe("Publish");
    expect(transitionLabel("published", "verified")).toBe("Unpublish");
  });
  it("stamps, keeps or clears last_verified_at", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    expect(transitionPatch("needs_review", "verified", now)).toEqual({ lastVerifiedAt: now });
    expect(transitionPatch("draft", "published", now)).toEqual({ lastVerifiedAt: now });
    expect(transitionPatch("verified", "published", now)).toEqual({});
    expect(transitionPatch("published", "verified", now)).toEqual({});
    expect(transitionPatch("verified", "needs_review", now)).toEqual({ lastVerifiedAt: null });
    expect(transitionPatch("published", "archived", now)).toEqual({ isFeatured: false });
  });
  it("validates status strings", () => {
    expect(isCatalogStatus("published")).toBe(true);
    expect(isCatalogStatus("partially_verified")).toBe(false);
    expect(isCatalogStatus(undefined)).toBe(false);
  });
});
