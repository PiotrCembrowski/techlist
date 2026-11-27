CREATE TYPE "public"."identifier_type" AS ENUM('gtin', 'mpn', 'model_number', 'provider_product_id');--> statement-breakpoint
CREATE TYPE "public"."image_rights_status" AS ENUM('needs_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."import_job_item_status" AS ENUM('pending', 'applied', 'needs_review', 'unchanged', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_job_kind" AS ENUM('csv', 'provider');--> statement-breakpoint
CREATE TYPE "public"."provider_mapping_type" AS ENUM('category', 'feature', 'brand');--> statement-breakpoint
ALTER TYPE "public"."import_status" ADD VALUE 'queued';--> statement-breakpoint
ALTER TYPE "public"."import_status" ADD VALUE 'running';--> statement-breakpoint
ALTER TYPE "public"."review_item_type" ADD VALUE 'field_conflict';--> statement-breakpoint
ALTER TYPE "public"."review_item_type" ADD VALUE 'image_rights';--> statement-breakpoint
CREATE TABLE "field_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"field" text NOT NULL,
	"source_id" uuid NOT NULL,
	"provider" text,
	"provider_product_id" text,
	"raw_value" jsonb,
	"value_hash" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"confidence" numeric(4, 3),
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_provenance_uq" UNIQUE NULLS NOT DISTINCT("product_id","variant_id","field","source_id"),
	CONSTRAINT "field_provenance_field_ck" CHECK ("field_provenance"."field" ~ '^[a-z][a-z0-9_]*(:[a-z0-9_.-]+)?$'),
	CONSTRAINT "field_provenance_hash_ck" CHECK ("field_provenance"."value_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "field_provenance_confidence_ck" CHECK ("field_provenance"."confidence" IS NULL OR ("field_provenance"."confidence" >= 0 AND "field_provenance"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "import_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"external_key" text NOT NULL,
	"status" "import_job_item_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload_hash" text,
	"product_id" uuid,
	"variant_id" uuid,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_job_items_key_uq" UNIQUE("job_id","external_key"),
	CONSTRAINT "import_job_items_seq_uq" UNIQUE("job_id","seq")
);
--> statement-breakpoint
CREATE TABLE "product_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"identifier_type" "identifier_type" NOT NULL,
	"value" text NOT NULL,
	"raw_value" text,
	"provider" text,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_identifiers_uq" UNIQUE NULLS NOT DISTINCT("product_id","variant_id","identifier_type","provider","value"),
	CONSTRAINT "product_identifiers_gtin_ck" CHECK ("product_identifiers"."identifier_type" <> 'gtin' OR "product_identifiers"."value" ~ '^[0-9]{14}$'),
	CONSTRAINT "product_identifiers_provider_ck" CHECK (("product_identifiers"."identifier_type" = 'provider_product_id') = ("product_identifiers"."provider" IS NOT NULL)
          AND ("product_identifiers"."provider" IS NULL OR "product_identifiers"."provider" ~ '^[a-z][a-z0-9_]{1,31}$')),
	CONSTRAINT "product_identifiers_value_ck" CHECK (length("product_identifiers"."value") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "provider_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"mapping_type" "provider_mapping_type" NOT NULL,
	"external_id" text NOT NULL,
	"external_name" text,
	"category_id" uuid,
	"target_category_id" uuid,
	"target_brand_id" uuid,
	"target_definition_id" uuid,
	"transform" jsonb,
	"action" text DEFAULT 'map' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_mappings_uq" UNIQUE NULLS NOT DISTINCT("provider","mapping_type","external_id","category_id"),
	CONSTRAINT "provider_mappings_provider_ck" CHECK ("provider_mappings"."provider" ~ '^[a-z][a-z0-9_]{1,31}$'),
	CONSTRAINT "provider_mappings_action_ck" CHECK ("provider_mappings"."action" IN ('map', 'ignore')),
	CONSTRAINT "provider_mappings_target_ck" CHECK ("provider_mappings"."action" = 'ignore' OR CASE "provider_mappings"."mapping_type"
            WHEN 'category' THEN "provider_mappings"."target_category_id" IS NOT NULL
            WHEN 'brand' THEN "provider_mappings"."target_brand_id" IS NOT NULL
            ELSE "provider_mappings"."target_definition_id" IS NOT NULL END)
);
--> statement-breakpoint
CREATE TABLE "provider_quota_usage" (
	"provider" text NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_seconds" integer NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"limit_value" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_quota_usage_provider_bucket_window_start_pk" PRIMARY KEY("provider","bucket","window_start"),
	CONSTRAINT "provider_quota_usage_used_ck" CHECK ("provider_quota_usage"."used" >= 0 AND "provider_quota_usage"."used" <= "provider_quota_usage"."limit_value"),
	CONSTRAINT "provider_quota_usage_window_ck" CHECK ("provider_quota_usage"."window_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "provider_response_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"request_key" text NOT NULL,
	"request_url" text NOT NULL,
	"http_status" integer NOT NULL,
	"content_type" text,
	"body" text NOT NULL,
	"body_hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_response_cache_uq" UNIQUE("provider","request_key"),
	CONSTRAINT "provider_response_cache_key_ck" CHECK ("provider_response_cache"."request_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "provider_settings" (
	"provider" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_health_status" text DEFAULT 'unknown' NOT NULL,
	"last_health_checked_at" timestamp with time zone,
	"last_health_message" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_settings_provider_ck" CHECK ("provider_settings"."provider" ~ '^[a-z][a-z0-9_]{1,31}$'),
	CONSTRAINT "provider_settings_health_ck" CHECK ("provider_settings"."last_health_status" IN ('unknown', 'ok', 'degraded', 'error', 'not_configured'))
);
--> statement-breakpoint
ALTER TABLE "product_images" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ALTER COLUMN "file_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ALTER COLUMN "file_checksum" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "remote_url" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "author" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "license_url" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "rights_status" "image_rights_status" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "provider_product_id" text;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "payload_hash" text;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "last_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "license_type" text;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "license_url" text;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "attribution_text" text;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "provider_quality" text;--> statement-breakpoint
ALTER TABLE "product_specifications" ADD COLUMN "raw_value" text;--> statement-breakpoint
ALTER TABLE "product_specifications" ADD COLUMN "raw_unit" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "provider_key" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "kind" "import_job_kind" DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "query" jsonb;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "caps" jsonb;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "checkpoint" jsonb;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "run_after" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_items" ADD CONSTRAINT "import_job_items_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_items" ADD CONSTRAINT "import_job_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_items" ADD CONSTRAINT "import_job_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_identifiers" ADD CONSTRAINT "product_identifiers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_identifiers" ADD CONSTRAINT "product_identifiers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_identifiers" ADD CONSTRAINT "product_identifiers_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_mappings" ADD CONSTRAINT "provider_mappings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_mappings" ADD CONSTRAINT "provider_mappings_target_category_id_categories_id_fk" FOREIGN KEY ("target_category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_mappings" ADD CONSTRAINT "provider_mappings_target_brand_id_brands_id_fk" FOREIGN KEY ("target_brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_mappings" ADD CONSTRAINT "provider_mappings_target_definition_id_specification_definitions_id_fk" FOREIGN KEY ("target_definition_id") REFERENCES "public"."specification_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_settings" ADD CONSTRAINT "provider_settings_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_provenance_product_idx" ON "field_provenance" USING btree ("product_id","field");--> statement-breakpoint
CREATE INDEX "import_job_items_status_idx" ON "import_job_items" USING btree ("job_id","status","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "product_identifiers_gtin_uq" ON "product_identifiers" USING btree ("value") WHERE "product_identifiers"."identifier_type" = 'gtin';--> statement-breakpoint
CREATE UNIQUE INDEX "product_identifiers_provider_uq" ON "product_identifiers" USING btree ("provider","value") WHERE "product_identifiers"."identifier_type" = 'provider_product_id';--> statement-breakpoint
CREATE INDEX "product_identifiers_lookup_idx" ON "product_identifiers" USING btree ("identifier_type","value");--> statement-breakpoint
CREATE INDEX "product_identifiers_product_idx" ON "product_identifiers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "provider_quota_usage_window_idx" ON "provider_quota_usage" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "provider_response_cache_expires_idx" ON "provider_response_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_remote_uq" ON "product_images" USING btree ("product_id","remote_url") WHERE "product_images"."remote_url" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_source_records_provider_id_uq" ON "product_source_records" USING btree ("source_id","provider_product_id") WHERE "product_source_records"."provider_product_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sources_provider_key_uq" ON "sources" USING btree ("provider_key") WHERE "sources"."provider_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "import_jobs_runnable_idx" ON "import_jobs" USING btree ("run_after") WHERE "import_jobs"."kind" = 'provider' AND "import_jobs"."status" NOT IN ('uploaded', 'validated', 'committed', 'failed', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_dedupe_uq" ON "import_jobs" USING btree ("dedupe_key") WHERE "import_jobs"."dedupe_key" IS NOT NULL AND "import_jobs"."status" NOT IN ('uploaded', 'validated', 'committed', 'failed', 'cancelled');--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_one_location_ck" CHECK (num_nonnulls("product_images"."storage_key", "product_images"."remote_url") = 1);--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_remote_https_ck" CHECK ("product_images"."remote_url" IS NULL OR "product_images"."remote_url" ~ '^https://');--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_size_ck" CHECK (("product_images"."width" IS NULL OR "product_images"."width" > 0) AND ("product_images"."height" IS NULL OR "product_images"."height" > 0));--> statement-breakpoint
ALTER TABLE "product_source_records" ADD CONSTRAINT "product_source_records_hash_ck" CHECK ("product_source_records"."payload_hash" IS NULL OR "product_source_records"."payload_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_provider_key_ck" CHECK ("sources"."provider_key" IS NULL OR "sources"."provider_key" ~ '^[a-z][a-z0-9_]{1,31}$');--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_kind_ck" CHECK (CASE "import_jobs"."kind" WHEN 'csv' THEN "import_jobs"."file_name" IS NOT NULL AND "import_jobs"."file_checksum" IS NOT NULL
          ELSE "import_jobs"."provider" IS NOT NULL AND "import_jobs"."query" IS NOT NULL END);--> statement-breakpoint
-- updated_at maintenance for the new tables (same trigger as 0002).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['field_provenance', 'import_job_items', 'provider_mappings', 'provider_settings', 'provider_quota_usage']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sb_set_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER sb_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sb_set_updated_at()', t);
  END LOOP;
END $$;
