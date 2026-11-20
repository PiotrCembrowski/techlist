ALTER TABLE "products" ADD COLUMN "search_text" text;--> statement-breakpoint
CREATE INDEX "products_search_text_trgm" ON "products" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_model_number_lower_idx" ON "products" USING btree (lower("model_number"));--> statement-breakpoint
CREATE INDEX "products_mpn_lower_idx" ON "products" USING btree (lower("manufacturer_part_number"));