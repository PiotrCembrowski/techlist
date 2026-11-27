/**
 * The single product/variant lifecycle status (DECISIONS D77). Pure; shared by the service, the
 * admin pages and tests.
 */
export const CATALOG_STATUSES = [
  "draft",
  "needs_review",
  "verified",
  "published",
  "rejected",
  "archived",
] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/**
 * Allowed status changes. Publishing straight from draft / needs_review is the admin's "verify &
 * publish": the editor who publishes vouches for the data, so it records last_verified_at like an
 * explicit verification. Unpublishing goes back to verified.
 */
export const STATUS_TRANSITIONS: Record<CatalogStatus, readonly CatalogStatus[]> = {
  draft: ["needs_review", "verified", "published", "rejected", "archived"],
  needs_review: ["draft", "verified", "published", "rejected", "archived"],
  verified: ["needs_review", "published", "rejected", "archived"],
  published: ["verified", "archived"],
  rejected: ["draft", "archived"],
  archived: ["draft"],
};

export function canTransition(from: CatalogStatus, to: CatalogStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export const STATUS_LABELS: Record<CatalogStatus, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  verified: "Verified",
  published: "Published",
  rejected: "Rejected",
  archived: "Archived",
};

/** Audit action name for a change. */
export function transitionAction(from: CatalogStatus, to: CatalogStatus): string {
  if (from === "published" && to === "verified") return "unpublish";
  if (to === "published" && from !== "verified") return "verify_and_publish";
  return {
    draft: "restore",
    needs_review: "submit_for_review",
    verified: "verify",
    published: "publish",
    rejected: "reject",
    archived: "archive",
  }[to];
}

/** Button label for a change in the admin. */
export function transitionLabel(from: CatalogStatus, to: CatalogStatus): string {
  switch (to) {
    case "needs_review":
      return from === "verified" ? "Send back to review" : "Submit for review";
    case "verified":
      return from === "published" ? "Unpublish" : "Mark verified";
    case "published":
      return from === "verified" ? "Publish" : "Verify & publish";
    case "rejected":
      return "Reject";
    case "archived":
      return "Archive";
    case "draft":
      return from === "needs_review" ? "Back to draft" : "Restore to draft";
  }
}

/** Fields that change with the status, besides the status itself. */
export function transitionPatch(
  from: CatalogStatus,
  to: CatalogStatus,
  now: Date,
): { lastVerifiedAt?: Date | null; isFeatured?: false } {
  const patch: { lastVerifiedAt?: Date | null; isFeatured?: false } = {};
  if (to === "verified" && from !== "published") patch.lastVerifiedAt = now;
  if (to === "published" && from !== "verified") patch.lastVerifiedAt = now;
  if (to === "draft" || to === "needs_review" || to === "rejected") patch.lastVerifiedAt = null;
  if (to === "archived" || to === "rejected") patch.isFeatured = false;
  return patch;
}

export function isCatalogStatus(value: unknown): value is CatalogStatus {
  return typeof value === "string" && (CATALOG_STATUSES as readonly string[]).includes(value);
}
