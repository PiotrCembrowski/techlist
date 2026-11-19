CREATE TYPE "public"."admin_role" AS ENUM('owner', 'editor');--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('in_stock', 'out_of_stock', 'preorder', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."comparison_direction" AS ENUM('higher_is_better', 'lower_is_better', 'none');--> statement-breakpoint
CREATE TYPE "public"."image_type" AS ENUM('product', 'detail', 'packaging', 'lifestyle');--> statement-breakpoint
CREATE TYPE "public"."import_row_action" AS ENUM('create', 'update', 'skip', 'conflict', 'error');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'validated', 'committed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."import_type" AS ENUM('products', 'offers');--> statement-breakpoint
CREATE TYPE "public"."link_type" AS ENUM('official', 'support', 'manual', 'driver', 'spec_sheet');--> statement-breakpoint
CREATE TYPE "public"."offer_condition" AS ENUM('new', 'used', 'refurbished');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('announced', 'active', 'discontinued', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."relationship_type" AS ENUM('successor', 'alternative', 'competitor', 'compatible_with', 'accessory_for', 'related');--> statement-breakpoint
CREATE TYPE "public"."review_item_type" AS ENUM('new_product', 'unverified_spec', 'conflicting_value', 'duplicate_candidate', 'variant_ambiguity', 'correction', 'suspicious_price');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('open', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."slug_entity_type" AS ENUM('product', 'brand', 'category', 'guide');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('manufacturer', 'licensed_provider', 'retailer', 'affiliate_network', 'manual_research', 'ai_extraction', 'community_submission');--> statement-breakpoint
CREATE TYPE "public"."spec_data_type" AS ENUM('text', 'integer', 'decimal', 'boolean', 'date', 'enum', 'multi_select');--> statement-breakpoint
CREATE TYPE "public"."spec_origin" AS ENUM('manual', 'import', 'ai_extracted');--> statement-breakpoint
CREATE TYPE "public"."spec_verification_status" AS ENUM('unverified', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('draft', 'needs_review', 'partially_verified', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"official_website_url" text,
	"logo_image_key" text,
	"country_of_origin" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug"),
	CONSTRAINT "brands_slug_ck" CHECK ("brands"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "brands_country_ck" CHECK ("brands"."country_of_origin" IS NULL OR "brands"."country_of_origin" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_slug_ck" CHECK ("categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "categories_not_own_parent_ck" CHECK ("categories"."parent_id" IS NULL OR "categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
CREATE TABLE "product_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_families_brand_slug_uq" UNIQUE("brand_id","slug"),
	CONSTRAINT "product_families_slug_ck" CHECK ("product_families"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"storage_key" text NOT NULL,
	"alt_text" text NOT NULL,
	"image_type" "image_type" DEFAULT 'product' NOT NULL,
	"source_id" uuid,
	"license_type" text,
	"attribution_text" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_storageKey_unique" UNIQUE("storage_key"),
	CONSTRAINT "product_images_key_ck" CHECK ("product_images"."storage_key" !~ '^[a-z]+://')
);
--> statement-breakpoint
CREATE TABLE "product_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"link_type" "link_type" NOT NULL,
	"url" text NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_links_uq" UNIQUE("product_id","link_type","url"),
	CONSTRAINT "product_links_https_ck" CHECK ("product_links"."url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "product_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_product_id" uuid NOT NULL,
	"target_product_id" uuid NOT NULL,
	"relationship_type" "relationship_type" NOT NULL,
	"confidence" numeric(4, 3),
	"source_id" uuid,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_relationships_uq" UNIQUE("source_product_id","target_product_id","relationship_type"),
	CONSTRAINT "product_relationships_not_self_ck" CHECK ("product_relationships"."source_product_id" <> "product_relationships"."target_product_id")
);
--> statement-breakpoint
CREATE TABLE "product_source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"source_id" uuid NOT NULL,
	"source_product_identifier" text,
	"source_url" text,
	"raw_data_reference" text,
	"retrieved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_source_records_uq" UNIQUE NULLS NOT DISTINCT("product_id","variant_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "product_specifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"specification_definition_id" uuid NOT NULL,
	"value_text" text,
	"value_numeric" numeric,
	"value_boolean" boolean,
	"value_date" date,
	"value_json" jsonb,
	"source_id" uuid,
	"origin" "spec_origin" DEFAULT 'manual' NOT NULL,
	"confidence" numeric(4, 3),
	"verification_status" "spec_verification_status" DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_specifications_value_uq" UNIQUE NULLS NOT DISTINCT("product_id","variant_id","specification_definition_id"),
	CONSTRAINT "product_specifications_one_value_ck" CHECK (num_nonnulls("product_specifications"."value_text", "product_specifications"."value_numeric", "product_specifications"."value_boolean", "product_specifications"."value_date", "product_specifications"."value_json") = 1),
	CONSTRAINT "product_specifications_confidence_ck" CHECK ("product_specifications"."confidence" IS NULL OR ("product_specifications"."confidence" >= 0 AND "product_specifications"."confidence" <= 1)),
	CONSTRAINT "product_specifications_verified_at_ck" CHECK ("product_specifications"."verification_status" <> 'verified' OR "product_specifications"."last_verified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_name" text NOT NULL,
	"variant_code" text NOT NULL,
	"manufacturer_part_number" text,
	"region_code" text,
	"color" text,
	"memory_configuration" text,
	"storage_configuration" text,
	"configuration_label" text,
	"barcode_gtin" text,
	"sku" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_product_code_uq" UNIQUE("product_id","variant_code"),
	CONSTRAINT "product_variants_code_ck" CHECK ("product_variants"."variant_code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "product_variants_region_ck" CHECK ("product_variants"."region_code" IS NULL OR "product_variants"."region_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "product_variants_gtin_ck" CHECK ("product_variants"."barcode_gtin" IS NULL OR "product_variants"."barcode_gtin" ~ '^([0-9]{8}|[0-9]{12,14})$')
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"family_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"model_name" text,
	"model_number" text,
	"manufacturer_part_number" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"short_description" text,
	"release_date" date,
	"announced_date" date,
	"discontinued_date" date,
	"product_status" "product_status" DEFAULT 'unknown' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'draft' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_slug_ck" CHECK ("products"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND position('-vs-' in "products"."slug") = 0)
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_name" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_url" text,
	"provider_name" text,
	"license_type" text,
	"license_notes" text,
	"access_method" text,
	"retrieved_at" timestamp with time zone,
	"attribution_required" boolean DEFAULT false NOT NULL,
	"usage_permitted" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specification_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"group_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"data_type" "spec_data_type" NOT NULL,
	"canonical_unit" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"is_comparable" boolean DEFAULT true NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"comparison_direction" "comparison_direction" DEFAULT 'none' NOT NULL,
	"validation_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specification_definitions_category_key_uq" UNIQUE("category_id","key"),
	CONSTRAINT "specification_definitions_key_ck" CHECK ("specification_definitions"."key" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "specification_definitions_unit_ck" CHECK ("specification_definitions"."canonical_unit" IS NULL OR "specification_definitions"."data_type" IN ('integer', 'decimal')),
	CONSTRAINT "specification_definitions_direction_ck" CHECK ("specification_definitions"."comparison_direction" = 'none' OR "specification_definitions"."data_type" IN ('integer', 'decimal', 'date', 'boolean'))
);
--> statement-breakpoint
CREATE TABLE "specification_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "specification_groups_category_key_uq" UNIQUE("category_id","key"),
	CONSTRAINT "specification_groups_key_ck" CHECK ("specification_groups"."key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "affiliate_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"market_country_code" text,
	"referrer_host" text,
	"is_probable_bot" boolean DEFAULT false NOT NULL,
	CONSTRAINT "affiliate_clicks_market_ck" CHECK ("affiliate_clicks"."market_country_code" IS NULL OR "affiliate_clicks"."market_country_code" = 'ALL' OR "affiliate_clicks"."market_country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "affiliate_clicks_host_ck" CHECK ("affiliate_clicks"."referrer_host" IS NULL OR "affiliate_clicks"."referrer_host" !~ '[/?#]')
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"retailer_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"price_amount" numeric(14, 4) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_id" uuid,
	CONSTRAINT "price_history_currency_ck" CHECK ("price_history"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "price_history_price_ck" CHECK ("price_history"."price_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "retailer_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"retailer_id" uuid NOT NULL,
	"retailer_product_id" text,
	"market_country_code" text NOT NULL,
	"product_url" text NOT NULL,
	"affiliate_url" text,
	"currency" text NOT NULL,
	"price_amount" numeric(14, 4) NOT NULL,
	"original_price_amount" numeric(14, 4),
	"shipping_cost" numeric(14, 4),
	"availability_status" "availability_status" DEFAULT 'unknown' NOT NULL,
	"condition" "offer_condition" DEFAULT 'new' NOT NULL,
	"source_id" uuid,
	"last_checked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retailer_offers_natural_uq" UNIQUE NULLS NOT DISTINCT("retailer_id","product_id","variant_id","market_country_code","condition"),
	CONSTRAINT "retailer_offers_price_ck" CHECK ("retailer_offers"."price_amount" > 0),
	CONSTRAINT "retailer_offers_original_price_ck" CHECK ("retailer_offers"."original_price_amount" IS NULL OR "retailer_offers"."original_price_amount" > 0),
	CONSTRAINT "retailer_offers_shipping_ck" CHECK ("retailer_offers"."shipping_cost" IS NULL OR "retailer_offers"."shipping_cost" >= 0),
	CONSTRAINT "retailer_offers_market_ck" CHECK ("retailer_offers"."market_country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "retailer_offers_currency_ck" CHECK ("retailer_offers"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "retailer_offers_product_url_ck" CHECK ("retailer_offers"."product_url" ~ '^https://'),
	CONSTRAINT "retailer_offers_affiliate_url_ck" CHECK ("retailer_offers"."affiliate_url" IS NULL OR "retailer_offers"."affiliate_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "retailers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"website_url" text NOT NULL,
	"allowed_redirect_hosts" text[] DEFAULT '{}'::text[] NOT NULL,
	"logo_image_key" text,
	"country_code" text NOT NULL,
	"supported_currencies" text[] NOT NULL,
	"affiliate_network" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retailers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "retailers_slug_ck" CHECK ("retailers"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "retailers_country_ck" CHECK ("retailers"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "retailers_currencies_ck" CHECK (cardinality("retailers"."supported_currencies") > 0 AND sb_is_currency_array("retailers"."supported_currencies")),
	CONSTRAINT "retailers_https_ck" CHECK ("retailers"."website_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "featured_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"product_ids" uuid[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "featured_comparisons_title_unique" UNIQUE("title"),
	CONSTRAINT "featured_comparisons_size_ck" CHECK (cardinality("featured_comparisons"."product_ids") BETWEEN 2 AND 4)
);
--> statement-breakpoint
CREATE TABLE "guide_categories" (
	"guide_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "guide_categories_guide_id_category_id_pk" PRIMARY KEY("guide_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "guide_products" (
	"guide_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "guide_products_guide_id_product_id_pk" PRIMARY KEY("guide_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "guides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"body_markdown" text NOT NULL,
	"author_name" text,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"seo_title" text,
	"seo_description" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guides_slug_unique" UNIQUE("slug"),
	CONSTRAINT "guides_slug_ck" CHECK ("guides"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "slug_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "slug_entity_type" NOT NULL,
	"old_slug" text NOT NULL,
	"new_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slug_redirects_old_uq" UNIQUE("entity_type","old_slug"),
	CONSTRAINT "slug_redirects_differs_ck" CHECK ("slug_redirects"."old_slug" <> "slug_redirects"."new_slug")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'editor' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_users_email_lower_ck" CHECK ("admin_users"."email" = lower("admin_users"."email"))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"previous_data" jsonb,
	"new_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"import_type" "import_type" NOT NULL,
	"file_name" text NOT NULL,
	"file_checksum" text NOT NULL,
	"column_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"successful_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"row_hash" text NOT NULL,
	"action" "import_row_action",
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_product_id" uuid,
	"matched_variant_id" uuid,
	CONSTRAINT "import_rows_job_row_uq" UNIQUE("job_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_type" "review_item_type" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "review_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_items_resolution_ck" CHECK (("review_items"."status" = 'open') = ("review_items"."resolved_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relationships" ADD CONSTRAINT "product_relationships_source_product_id_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relationships" ADD CONSTRAINT "product_relationships_target_product_id_products_id_fk" FOREIGN KEY ("target_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relationships" ADD CONSTRAINT "product_relationships_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD CONSTRAINT "product_source_records_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD CONSTRAINT "product_source_records_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD CONSTRAINT "product_source_records_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_specifications" ADD CONSTRAINT "product_specifications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_specifications" ADD CONSTRAINT "product_specifications_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_specifications" ADD CONSTRAINT "product_specifications_specification_definition_id_specification_definitions_id_fk" FOREIGN KEY ("specification_definition_id") REFERENCES "public"."specification_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_specifications" ADD CONSTRAINT "product_specifications_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_family_id_product_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."product_families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_definitions" ADD CONSTRAINT "specification_definitions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_definitions" ADD CONSTRAINT "specification_definitions_group_id_specification_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."specification_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_groups" ADD CONSTRAINT "specification_groups_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_offer_id_retailer_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."retailer_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_offer_id_retailer_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."retailer_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_offers" ADD CONSTRAINT "retailer_offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_offers" ADD CONSTRAINT "retailer_offers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_offers" ADD CONSTRAINT "retailer_offers_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_offers" ADD CONSTRAINT "retailer_offers_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_categories" ADD CONSTRAINT "guide_categories_guide_id_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_categories" ADD CONSTRAINT "guide_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_products" ADD CONSTRAINT "guide_products_guide_id_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_products" ADD CONSTRAINT "guide_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_matched_product_id_products_id_fk" FOREIGN KEY ("matched_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_matched_variant_id_product_variants_id_fk" FOREIGN KEY ("matched_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_resolved_by_admin_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_normalized_uq" ON "brands" USING btree (lower(sb_unaccent("name")));--> statement-breakpoint
CREATE INDEX "brands_aliases_gin" ON "brands" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "brands_name_trgm" ON "brands" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_one_primary_uq" ON "product_images" USING btree ("product_id") WHERE "product_images"."is_primary";--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id","display_order");--> statement-breakpoint
CREATE INDEX "product_relationships_target_idx" ON "product_relationships" USING btree ("target_product_id","relationship_type");--> statement-breakpoint
CREATE INDEX "product_source_records_product_idx" ON "product_source_records" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_specifications_filter_idx" ON "product_specifications" USING btree ("specification_definition_id","value_numeric");--> statement-breakpoint
CREATE INDEX "product_specifications_product_idx" ON "product_specifications" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_gtin_uq" ON "product_variants" USING btree ("barcode_gtin") WHERE "product_variants"."barcode_gtin" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_one_default_uq" ON "product_variants" USING btree ("product_id") WHERE "product_variants"."is_default";--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_mpn_idx" ON "product_variants" USING btree (lower("manufacturer_part_number"));--> statement-breakpoint
CREATE UNIQUE INDEX "products_brand_model_number_uq" ON "products" USING btree ("brand_id",lower("model_number")) WHERE "products"."model_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_model_number_trgm" ON "products" USING gin ("model_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_mpn_trgm" ON "products" USING gin ("manufacturer_part_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_aliases_gin" ON "products" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "products_search_vector_gin" ON "products" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "products_category_pub_idx" ON "products" USING btree ("category_id","publication_status");--> statement-breakpoint
CREATE INDEX "products_brand_pub_idx" ON "products" USING btree ("brand_id","publication_status");--> statement-breakpoint
CREATE INDEX "products_family_idx" ON "products" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "products_created_idx" ON "products" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sources_name_uq" ON "sources" USING btree (lower("source_name"));--> statement-breakpoint
CREATE INDEX "specification_definitions_category_idx" ON "specification_definitions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "affiliate_clicks_offer_idx" ON "affiliate_clicks" USING btree ("offer_id","clicked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_history_product_recorded_idx" ON "price_history" USING btree ("product_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_history_offer_idx" ON "price_history" USING btree ("offer_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "retailer_offers_product_market_idx" ON "retailer_offers" USING btree ("product_id","market_country_code","is_active");--> statement-breakpoint
CREATE INDEX "retailer_offers_variant_idx" ON "retailer_offers" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "retailer_offers_last_checked_idx" ON "retailer_offers" USING btree ("last_checked_at");--> statement-breakpoint
CREATE INDEX "guide_categories_category_idx" ON "guide_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "guide_products_product_idx" ON "guide_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "guides_published_idx" ON "guides" USING btree ("publication_status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_jobs_created_idx" ON "import_jobs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_rows_hash_idx" ON "import_rows" USING btree ("row_hash");--> statement-breakpoint
CREATE INDEX "import_rows_job_action_idx" ON "import_rows" USING btree ("job_id","action");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "review_items_open_idx" ON "review_items" USING btree ("status","item_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_items_entity_idx" ON "review_items" USING btree ("entity_type","entity_id");