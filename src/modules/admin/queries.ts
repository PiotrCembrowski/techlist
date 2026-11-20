import { asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { productImages, products as productsTable, productVariants } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";

/** SPEC §9.1 dashboard counts, in one round trip. */
export async function getDashboardStats(db: DbOrTx, staleHours: number) {
  const [row] = await db.execute<Record<string, number | Record<string, number>>>(sql`
    SELECT
      (SELECT coalesce(jsonb_object_agg(publication_status, n), '{}') FROM (SELECT publication_status, count(*)::int n FROM products GROUP BY 1) t) AS by_publication,
      (SELECT coalesce(jsonb_object_agg(verification_status, n), '{}') FROM (SELECT verification_status, count(*)::int n FROM products GROUP BY 1) t) AS by_verification,
      (SELECT count(*)::int FROM product_variants) AS variants,
      (SELECT count(*)::int FROM retailers WHERE is_active) AS active_retailers,
      (SELECT count(*)::int FROM retailer_offers WHERE is_active AND (expires_at IS NULL OR expires_at > now())) AS active_offers,
      (SELECT count(*)::int FROM retailer_offers WHERE is_active AND (expires_at IS NULL OR expires_at > now())
         AND last_checked_at < now() - make_interval(hours => ${staleHours})) AS stale_offers,
      (SELECT count(*)::int FROM retailer_offers WHERE is_active AND expires_at < now()) AS expired_offers,
      (SELECT count(*)::int FROM review_items WHERE status = 'open') AS open_reviews`);
  const r = row as Record<string, unknown>;
  return {
    byPublication: (r.by_publication ?? {}) as Record<string, number>,
    byVerification: (r.by_verification ?? {}) as Record<string, number>,
    variants: Number(r.variants),
    activeRetailers: Number(r.active_retailers),
    activeOffers: Number(r.active_offers),
    staleOffers: Number(r.stale_offers),
    expiredOffers: Number(r.expired_offers),
    openReviews: Number(r.open_reviews),
  };
}

export async function listRecentImports(db: DbOrTx, limit = 5) {
  return db.execute<{
    id: string;
    file_name: string;
    import_type: string;
    status: string;
    total_rows: number;
    created_at: string;
  }>(sql`
    SELECT id, file_name, import_type, status, total_rows, created_at::text FROM import_jobs ORDER BY created_at DESC LIMIT ${limit}`);
}

export async function listAuditLogs(
  db: DbOrTx,
  opts: { page?: number; entityType?: string | null; entityId?: string | null } = {},
) {
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  const conds: SQL[] = [sql`TRUE`];
  if (opts.entityType) conds.push(sql`a.entity_type = ${opts.entityType}`);
  if (opts.entityId) conds.push(sql`a.entity_id = ${opts.entityId}`);
  const where = sql.join(conds, sql` AND `);
  const rows = await db.execute<{
    id: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    created_at: string;
    admin_email: string | null;
    previous_data: Record<string, unknown> | null;
    new_data: Record<string, unknown> | null;
  }>(sql`
    SELECT a.id, a.entity_type, a.entity_id, a.action, a.created_at::text, u.email AS admin_email, a.previous_data, a.new_data
    FROM audit_logs a LEFT JOIN admin_users u ON u.id = a.admin_user_id
    WHERE ${where} ORDER BY a.created_at DESC LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`);
  return { items: rows.slice(0, pageSize), page, hasNext: rows.length > pageSize };
}

export interface AdminProductFilters {
  q?: string | null;
  publication?: string | null;
  verification?: string | null;
  page?: number;
}

export async function listProductsAdmin(db: DbOrTx, f: AdminProductFilters) {
  const pageSize = 48;
  const page = Math.max(1, f.page ?? 1);
  const conds: SQL[] = [sql`TRUE`];
  if (f.q) {
    const like = `%${f.q.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(
      sql`(lower(p.name) LIKE ${like} OR lower(p.model_number) LIKE ${like} OR lower(b.name) LIKE ${like} OR p.slug LIKE ${like})`,
    );
  }
  if (f.publication) conds.push(sql`p.publication_status = ${f.publication}`);
  if (f.verification) conds.push(sql`p.verification_status = ${f.verification}`);
  const where = sql.join(conds, sql` AND `);
  const [rows, [total]] = await Promise.all([
    db.execute<{
      id: string;
      name: string;
      slug: string;
      model_number: string | null;
      brand_name: string;
      brand_slug: string;
      category_name: string;
      publication_status: string;
      verification_status: string;
      updated_at: string;
    }>(sql`
      SELECT p.id, p.name, p.slug, p.model_number, b.name AS brand_name, b.slug AS brand_slug, c.name AS category_name,
             p.publication_status, p.verification_status, p.updated_at::text
      FROM products p JOIN brands b ON b.id = p.brand_id JOIN categories c ON c.id = p.category_id
      WHERE ${where} ORDER BY p.updated_at DESC, p.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM products p JOIN brands b ON b.id = p.brand_id WHERE ${where}`),
  ]);
  return {
    items: rows,
    total: Number(total?.n ?? 0),
    page,
    pageCount: Math.max(1, Math.ceil(Number(total?.n ?? 0) / pageSize)),
  };
}

export type OfferListFilter = "all" | "stale" | "expired" | "inactive";

export async function listOffersAdmin(
  db: DbOrTx,
  opts: { filter: OfferListFilter; staleHours: number; productId?: string | null; page?: number },
) {
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  const conds: SQL[] = [sql`TRUE`];
  if (opts.filter === "stale") {
    conds.push(
      sql`o.is_active AND (o.expires_at IS NULL OR o.expires_at > now()) AND o.last_checked_at < now() - make_interval(hours => ${opts.staleHours})`,
    );
  } else if (opts.filter === "expired") conds.push(sql`o.expires_at < now()`);
  else if (opts.filter === "inactive") conds.push(sql`NOT o.is_active`);
  if (opts.productId) conds.push(sql`o.product_id = ${opts.productId}`);
  const where = sql.join(conds, sql` AND `);
  const rows = await db.execute<{
    id: string;
    product_name: string;
    product_id: string;
    variant_name: string | null;
    retailer_name: string;
    market_country_code: string;
    currency: string;
    price_amount: string;
    availability_status: string;
    last_checked_at: string;
    expires_at: string | null;
    is_active: boolean;
    is_demo: boolean;
    is_expired: boolean;
    is_stale: boolean;
  }>(sql`
    SELECT o.id, p.name AS product_name, p.id AS product_id, v.variant_name, r.name AS retailer_name, o.market_country_code,
           o.currency, o.price_amount::text, o.availability_status, o.last_checked_at::text, o.expires_at::text, o.is_active, o.is_demo,
           coalesce(o.expires_at < now(), false) AS is_expired,
           o.last_checked_at < now() - make_interval(hours => ${opts.staleHours}) AS is_stale
    FROM retailer_offers o JOIN products p ON p.id = o.product_id JOIN retailers r ON r.id = o.retailer_id
    LEFT JOIN product_variants v ON v.id = o.variant_id
    WHERE ${where} ORDER BY o.last_checked_at ASC, o.id LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`);
  return { items: rows.slice(0, pageSize), page, hasNext: rows.length > pageSize };
}

/** Lightweight option lists for admin selects (bounded). */
export async function getAdminOptions(db: DbOrTx) {
  const [brands, categories, sources, retailers] = await Promise.all([
    db.execute<{ id: string; name: string }>(
      sql`SELECT id, name FROM brands ORDER BY name LIMIT 500`,
    ),
    db.execute<{ id: string; name: string; parent_name: string | null }>(sql`
      SELECT c.id, c.name, pc.name AS parent_name FROM categories c LEFT JOIN categories pc ON pc.id = c.parent_id ORDER BY coalesce(pc.sort_order, c.sort_order), pc.name NULLS FIRST, c.sort_order LIMIT 500`),
    db.execute<{ id: string; source_name: string; usage_permitted: boolean }>(
      sql`SELECT id, source_name, usage_permitted FROM sources ORDER BY source_name LIMIT 500`,
    ),
    db.execute<{ id: string; name: string; supported_currencies: string[] }>(
      sql`SELECT id, name, supported_currencies FROM retailers ORDER BY name LIMIT 500`,
    ),
  ]);
  return {
    brands: brands.map((b) => ({ value: b.id, label: b.name })),
    categories: categories.map((c) => ({
      value: c.id,
      label: c.parent_name ? `${c.parent_name} › ${c.name}` : c.name,
    })),
    sources: sources.map((s) => ({
      value: s.id,
      label: s.usage_permitted ? s.source_name : `${s.source_name} (use not permitted)`,
    })),
    retailers: retailers.map((r) => ({
      value: r.id,
      label: `${r.name} (${r.supported_currencies.join(", ")})`,
    })),
  };
}

/** Product lookup for relationship pickers. */
export async function searchProductsAdmin(db: DbOrTx, q: string, excludeId?: string) {
  const like = `%${q.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  return db.execute<{ id: string; name: string; brand_name: string }>(sql`
    SELECT p.id, p.name, b.name AS brand_name FROM products p JOIN brands b ON b.id = p.brand_id
    WHERE (lower(p.name) LIKE ${like} OR lower(p.model_number) LIKE ${like}) ${excludeId ? sql`AND p.id <> ${excludeId}` : sql``}
    ORDER BY p.name LIMIT 20`);
}

/** Everything the product edit page shows, in a handful of bounded queries. */
export async function getProductAdmin(db: DbOrTx, id: string) {
  const [product] = await db.execute<{ id: string }>(sql`SELECT id FROM products WHERE id = ${id}`);
  if (!product) return null;
  const [[p], variants, images, rels, records, links, [specCount], [brand]] = await Promise.all([
    db.select().from(productsTable).where(eq(productsTable.id, id)),
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))
      .orderBy(desc(productVariants.isDefault), asc(productVariants.variantName))
      .limit(100),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.displayOrder))
      .limit(50),
    db.execute<{
      id: string;
      relationship_type: string;
      direction: "out" | "in";
      other_id: string;
      other_name: string;
      brand_name: string;
    }>(sql`
      SELECT r.id, r.relationship_type, CASE WHEN r.source_product_id = ${id} THEN 'out' ELSE 'in' END AS direction,
             o.id AS other_id, o.name AS other_name, b.name AS brand_name
      FROM product_relationships r
      JOIN products o ON o.id = CASE WHEN r.source_product_id = ${id} THEN r.target_product_id ELSE r.source_product_id END
      JOIN brands b ON b.id = o.brand_id
      WHERE r.source_product_id = ${id} OR r.target_product_id = ${id}
      ORDER BY r.relationship_type, o.name LIMIT 100`),
    db.execute<{
      id: string;
      source_name: string;
      source_type: string;
      source_url: string | null;
      retrieved_at: string | null;
      variant_name: string | null;
    }>(sql`
      SELECT r.id, s.source_name, s.source_type, coalesce(r.source_url, s.source_url) AS source_url, r.retrieved_at::text, v.variant_name
      FROM product_source_records r JOIN sources s ON s.id = r.source_id LEFT JOIN product_variants v ON v.id = r.variant_id
      WHERE r.product_id = ${id} ORDER BY r.created_at LIMIT 50`),
    db.execute<{
      id: string;
      link_type: string;
      url: string;
      source_name: string | null;
      usage_permitted: boolean | null;
    }>(sql`
      SELECT l.id, l.link_type, l.url, s.source_name, s.usage_permitted FROM product_links l LEFT JOIN sources s ON s.id = l.source_id
      WHERE l.product_id = ${id} ORDER BY l.link_type LIMIT 50`),
    db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM product_specifications WHERE product_id = ${id}`,
    ),
    db.execute<{ slug: string; name: string }>(
      sql`SELECT b.slug, b.name FROM brands b JOIN products p ON p.brand_id = b.id WHERE p.id = ${id}`,
    ),
  ]);
  return {
    product: p!,
    brand: brand!,
    variants,
    images,
    relationships: rels.map((r) => ({
      id: r.id,
      // Stored successor rows read as "Predecessor" from the other side.
      label:
        r.relationship_type === "successor"
          ? r.direction === "out"
            ? "Successor"
            : "Predecessor"
          : r.relationship_type.replace(/_/g, " "),
      otherId: r.other_id,
      otherName: `${r.brand_name} ${r.other_name}`,
    })),
    sourceRecords: records,
    links,
    specCount: Number(specCount?.n ?? 0),
  };
}
