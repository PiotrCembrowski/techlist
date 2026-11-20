import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";

export interface PublicImage {
  id: string;
  src: string;
  alt: string;
  attribution: string | null;
  isPrimary: boolean;
}

/** Public URL of an uploaded file (served by app/media/[...key]). */
export function mediaUrl(storageKey: string): string {
  return `/media/${storageKey}`;
}

/**
 * Images may appear publicly only when they were uploaded with no source or with a source whose
 * usage is permitted (rule 2.1.9: never assume redistribution rights).
 */
const VISIBLE = sql`(i.source_id IS NULL OR s.usage_permitted)`;

type Row = {
  id: string;
  storage_key: string;
  alt_text: string;
  attribution_text: string | null;
  is_primary: boolean;
  product_id: string;
};

const toImage = (r: Row): PublicImage => ({
  id: r.id,
  src: mediaUrl(r.storage_key),
  alt: r.alt_text,
  attribution: r.attribution_text,
  isPrimary: r.is_primary,
});

/** Gallery for a product page: product-level images plus the selected variant's, primary first. */
export async function getProductGallery(
  db: DbOrTx,
  productId: string,
  variantId: string | null,
  limit = 12,
): Promise<PublicImage[]> {
  const rows = await db.execute<Row>(sql`
    SELECT i.id, i.storage_key, i.alt_text, i.attribution_text, i.is_primary, i.product_id
    FROM product_images i LEFT JOIN sources s ON s.id = i.source_id
    WHERE i.product_id = ${productId} AND ${VISIBLE}
      AND (i.variant_id IS NULL ${variantId ? sql`OR i.variant_id = ${variantId}` : sql``})
    ORDER BY (i.variant_id IS NOT NULL) DESC, i.is_primary DESC, i.display_order, i.created_at
    LIMIT ${Math.min(limit, 24)}`);
  return rows.map(toImage);
}

/** One representative image per product (primary, else the first visible), for cards. */
export async function getPrimaryImages(
  db: DbOrTx,
  productIds: string[],
): Promise<Map<string, PublicImage>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.execute<Row>(sql`
    SELECT DISTINCT ON (i.product_id) i.id, i.storage_key, i.alt_text, i.attribution_text, i.is_primary, i.product_id
    FROM product_images i LEFT JOIN sources s ON s.id = i.source_id
    WHERE i.product_id = ANY(${sql.param(productIds.slice(0, 200))}::uuid[]) AND i.variant_id IS NULL AND ${VISIBLE}
    ORDER BY i.product_id, i.is_primary DESC, i.display_order, i.created_at`);
  return new Map(rows.map((r) => [r.product_id, toImage(r)]));
}
