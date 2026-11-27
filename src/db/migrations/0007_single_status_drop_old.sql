-- Indexability with the single status (DECISIONS D77): a product is published only after an
-- editor verified it, so "published" replaces "published AND verified/partially verified".
-- Replaced before the old columns are dropped.
CREATE OR REPLACE FUNCTION sb_indexable_products(
  p_category_ids uuid[] DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_ids uuid[] DEFAULT NULL
) RETURNS TABLE (id uuid, brand_id uuid, category_id uuid, slug text, brand_slug text, updated_at timestamptz)
  LANGUAGE sql STABLE
  AS $$
  WITH RECURSIVE category_ancestors(category_id, ancestor_id, depth) AS (
    SELECT id, id, 0 FROM categories
    UNION ALL
    SELECT a.category_id, c.parent_id, a.depth + 1
    FROM category_ancestors a JOIN categories c ON c.id = a.ancestor_id
    WHERE c.parent_id IS NOT NULL AND a.depth < 8
  ),
  required_definitions AS (
    SELECT a.category_id, d.id AS definition_id
    FROM category_ancestors a JOIN specification_definitions d ON d.category_id = a.ancestor_id AND d.is_required
  ),
  candidates AS (
    SELECT p.id, p.brand_id, p.category_id, p.slug, b.slug AS brand_slug, p.updated_at
    FROM products p JOIN brands b ON b.id = p.brand_id AND b.is_active
    WHERE p.status = 'published'
      AND NOT p.is_demo
      AND (p_category_ids IS NULL OR p.category_id = ANY (p_category_ids))
      AND (p_brand_id IS NULL OR p.brand_id = p_brand_id)
      AND (p_ids IS NULL OR p.id = ANY (p_ids))
  ),
  coverage AS (
    SELECT c.id, count(r.definition_id) AS required_total, count(ps.id) AS required_present
    FROM candidates c
    LEFT JOIN required_definitions r ON r.category_id = c.category_id
    LEFT JOIN product_specifications ps
      ON ps.product_id = c.id AND ps.variant_id IS NULL AND ps.specification_definition_id = r.definition_id
    GROUP BY c.id
  )
  SELECT c.id, c.brand_id, c.category_id, c.slug, c.brand_slug, c.updated_at
  FROM candidates c JOIN coverage cv ON cv.id = c.id
  WHERE cv.required_total = 0 OR cv.required_present >= 0.6 * cv.required_total
$$;
--> statement-breakpoint
DROP INDEX "products_category_pub_idx";--> statement-breakpoint
DROP INDEX "products_brand_pub_idx";--> statement-breakpoint
CREATE INDEX "products_category_status_idx" ON "products" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "products_brand_status_idx" ON "products" USING btree ("brand_id","status");--> statement-breakpoint
ALTER TABLE "product_variants" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "publication_status";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "verification_status";--> statement-breakpoint
DROP TYPE "public"."verification_status";
