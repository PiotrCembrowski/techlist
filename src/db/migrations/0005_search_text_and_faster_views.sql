-- 1. search_text: lower(unaccent(brand + " " + name)) for index-backed fuzzy search (trigram GIN
--    index from 0004). Maintained with search_vector by the same trigger; brand renames already
--    refresh products through sb_brands_refresh_search().
CREATE OR REPLACE FUNCTION sb_products_search_vector() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  brand_text text;
  brand_name text;
BEGIN
  SELECT b.name || ' ' || array_to_string(b.aliases, ' '), b.name INTO brand_text, brand_name FROM brands b WHERE b.id = NEW.brand_id;
  NEW.search_vector :=
    setweight(to_tsvector('simple', sb_unaccent(coalesce(NEW.name, ''))), 'A') ||
    setweight(to_tsvector('simple', sb_unaccent(coalesce(NEW.model_number, '') || ' ' || coalesce(NEW.manufacturer_part_number, ''))), 'A') ||
    setweight(to_tsvector('simple', sb_unaccent(coalesce(NEW.model_name, '') || ' ' || array_to_string(NEW.aliases, ' '))), 'B') ||
    setweight(to_tsvector('simple', sb_unaccent(coalesce(brand_text, ''))), 'B');
  NEW.search_text := lower(sb_unaccent(coalesce(brand_name, '') || ' ' || coalesce(NEW.name, '')));
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fire the trigger for existing rows (search_vector is in its UPDATE OF list).
UPDATE products SET search_vector = NULL;
--> statement-breakpoint
-- 2. Indexability (same rule as 0003) as one SQL function with optional filters, so counts for a
--    category subtree, a brand or a list of products only evaluate those products. Coverage is
--    computed only for candidates (published, not demo, verified, active brand). The view keeps
--    the unfiltered form for the sitemap.
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
    WHERE p.publication_status = 'published'
      AND NOT p.is_demo
      AND p.verification_status IN ('verified', 'partially_verified')
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
CREATE OR REPLACE VIEW indexable_products AS SELECT * FROM sb_indexable_products();
