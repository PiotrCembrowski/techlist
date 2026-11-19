import { pgEnum } from "drizzle-orm/pg-core";

export const productStatus = pgEnum("product_status", [
  "announced",
  "active",
  "discontinued",
  "unknown",
]);
export const publicationStatus = pgEnum("publication_status", ["draft", "published", "archived"]);
export const verificationStatus = pgEnum("verification_status", [
  "draft",
  "needs_review",
  "partially_verified",
  "verified",
  "rejected",
]);
/** Per-value status. AI-extracted and imported values start as `unverified` (rule 2.1.8). */
export const specVerificationStatus = pgEnum("spec_verification_status", [
  "unverified",
  "verified",
  "rejected",
]);
export const specDataType = pgEnum("spec_data_type", [
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "enum",
  "multi_select",
]);
export const comparisonDirection = pgEnum("comparison_direction", [
  "higher_is_better",
  "lower_is_better",
  "none",
]);
export const specOrigin = pgEnum("spec_origin", ["manual", "import", "ai_extracted"]);
export const sourceType = pgEnum("source_type", [
  "manufacturer",
  "licensed_provider",
  "retailer",
  "affiliate_network",
  "manual_research",
  "ai_extraction",
  "community_submission",
]);
export const linkType = pgEnum("link_type", [
  "official",
  "support",
  "manual",
  "driver",
  "spec_sheet",
]);
export const imageType = pgEnum("image_type", ["product", "detail", "packaging", "lifestyle"]);
export const relationshipType = pgEnum("relationship_type", [
  "successor",
  "alternative",
  "competitor",
  "compatible_with",
  "accessory_for",
  "related",
]);
export const availabilityStatus = pgEnum("availability_status", [
  "in_stock",
  "out_of_stock",
  "preorder",
  "unknown",
]);
export const offerCondition = pgEnum("offer_condition", ["new", "used", "refurbished"]);
export const slugEntityType = pgEnum("slug_entity_type", ["product", "brand", "category", "guide"]);
export const importType = pgEnum("import_type", ["products", "offers"]);
export const importStatus = pgEnum("import_status", [
  "uploaded",
  "validated",
  "committed",
  "failed",
  "cancelled",
]);
export const importRowAction = pgEnum("import_row_action", [
  "create",
  "update",
  "skip",
  "conflict",
  "error",
]);
export const reviewItemType = pgEnum("review_item_type", [
  "new_product",
  "unverified_spec",
  "conflicting_value",
  "duplicate_candidate",
  "variant_ambiguity",
  "correction",
  "suspicious_price",
]);
export const reviewStatus = pgEnum("review_status", ["open", "approved", "rejected"]);
export const adminRole = pgEnum("admin_role", ["owner", "editor"]);
