ALTER TABLE "field_provenance" ALTER COLUMN "source_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "raw_record" jsonb;--> statement-breakpoint
ALTER TABLE "product_source_records" ADD COLUMN "unmapped_features" jsonb;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD COLUMN "is_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD COLUMN "admin_user_id" uuid;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_origin_ck" CHECK (("field_provenance"."source_id" IS NOT NULL AND NOT "field_provenance"."is_manual") OR ("field_provenance"."source_id" IS NULL AND "field_provenance"."is_manual"));