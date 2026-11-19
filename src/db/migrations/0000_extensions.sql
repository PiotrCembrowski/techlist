-- Extensions and helper functions used by later migrations (indexes, CHECKs, triggers).
-- pg_trgm and unaccent are "trusted" extensions: the database owner can create them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
-- unaccent() is only STABLE (it depends on search_path), so it cannot be used in an index.
-- This wrapper pins the dictionary explicitly and is safe to mark IMMUTABLE.
CREATE OR REPLACE FUNCTION sb_unaccent(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, input) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sb_is_currency_array(arr text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT coalesce(bool_and(c ~ '^[A-Z]{3}$'), true) FROM unnest(arr) AS c $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sb_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
