CREATE TYPE "public"."catalog_status" AS ENUM('draft', 'needs_review', 'verified', 'published', 'rejected', 'archived');--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "status" "catalog_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" "catalog_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
-- Backfill the single status from the two old columns (DECISIONS D77). Published products were
-- reviewed by an editor before publishing, so they stay published whatever their old verification.
UPDATE "products" SET "status" = CASE
  WHEN "publication_status" = 'archived' THEN 'archived'
  WHEN "publication_status" = 'published' THEN 'published'
  WHEN "verification_status" = 'rejected' THEN 'rejected'
  WHEN "verification_status" = 'verified' THEN 'verified'
  WHEN "verification_status" IN ('needs_review', 'partially_verified') THEN 'needs_review'
  ELSE 'draft'
END::"catalog_status";--> statement-breakpoint
UPDATE "product_variants" SET "status" = CASE WHEN "is_active" THEN 'published' ELSE 'archived' END::"catalog_status";
