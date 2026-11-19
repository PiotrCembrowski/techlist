-- updated_at maintenance for every table that has the column.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sb_set_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER sb_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sb_set_updated_at()', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Full-text search document for products: name, model, part numbers, aliases and brand name.
-- Uses the 'simple' configuration (no language stemming: the catalog is global) and sb_unaccent.
CREATE OR REPLACE FUNCTION sb_products_search_vector() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  brand_text text;
BEGIN
  SELECT b.name || ' ' || array_to_string(b.aliases, ' ') INTO brand_text FROM brands b WHERE b.id = NEW.brand_id;
  NEW.search_vector :=
    setweight(to_tsvector('simple', sb_unaccent(coalesce(NEW.name, ''))), 'A') ||
    setweight(to_tsvector('simple', sb_unaccent(coalesce(NEW.model_number, '') || ' ' || coalesce(NEW.manufacturer_part_number, ''))), 'A') ||
    setweight(to_tsvector('simple', sb_unaccent(coalesce(NEW.model_name, '') || ' ' || array_to_string(NEW.aliases, ' '))), 'B') ||
    setweight(to_tsvector('simple', sb_unaccent(coalesce(brand_text, ''))), 'B');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sb_products_search_vector
  BEFORE INSERT OR UPDATE OF name, model_name, model_number, manufacturer_part_number, aliases, brand_id, search_vector
  ON products FOR EACH ROW EXECUTE FUNCTION sb_products_search_vector();
--> statement-breakpoint
-- Renaming a brand (or changing its aliases) refreshes its products' search documents.
CREATE OR REPLACE FUNCTION sb_brands_refresh_search() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.aliases IS DISTINCT FROM OLD.aliases THEN
    UPDATE products SET search_vector = NULL WHERE brand_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sb_brands_refresh_search
  AFTER UPDATE OF name, aliases ON brands FOR EACH ROW EXECUTE FUNCTION sb_brands_refresh_search();
