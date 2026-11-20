-- SPEC §12 product indexability, mirrored from src/modules/seo/indexability.ts (getIndexability,
-- kind "product"). Keep both in step; tests/integration/seo.test.ts compares them.
-- A product is indexable when it is published, not demo data, its brand is active, its
-- verification status is verified or partially_verified, and at least 60 % of the required
-- specifications of its category (including inherited ones) have a product-level value.
CREATE VIEW indexable_products AS
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
coverage AS (
  SELECT p.id AS product_id,
         count(r.definition_id) AS required_total,
         count(ps.id) AS required_present
  FROM products p
  LEFT JOIN required_definitions r ON r.category_id = p.category_id
  LEFT JOIN product_specifications ps
    ON ps.product_id = p.id AND ps.variant_id IS NULL AND ps.specification_definition_id = r.definition_id
  GROUP BY p.id
)
SELECT p.id, p.brand_id, p.category_id, p.slug, b.slug AS brand_slug, p.updated_at
FROM products p
JOIN brands b ON b.id = p.brand_id AND b.is_active
JOIN coverage c ON c.product_id = p.id
WHERE p.publication_status = 'published'
  AND NOT p.is_demo
  AND p.verification_status IN ('verified', 'partially_verified')
  AND (c.required_total = 0 OR c.required_present >= 0.6 * c.required_total);
