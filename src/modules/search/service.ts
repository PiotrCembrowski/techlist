import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  getProductCards,
  productHref,
  type CatalogOptions,
  type ProductCardData,
} from "@/modules/catalog/service";
import { buildPrefixTsQuery, fold } from "./query";

export const SEARCH_PAGE_SIZE = 20;
export const SUGGEST_LIMIT = 8;
export const MIN_QUERY_LENGTH = 2;
/** word_similarity cut-off. 0.35 admits one-letter typos in short names ("aeara" -> "Aera" = 0.375). */
const FUZZY_THRESHOLD = 0.35;

export interface SearchProductHit extends ProductCardData {
  /** Exact model number / MPN / GTIN match — shown prominently. */
  exact: boolean;
  /** Variant matched by GTIN or variant MPN, if any. */
  matchedVariantCode: string | null;
}

export interface BrandHit {
  slug: string;
  name: string;
  productCount: number;
}

export interface CategoryHit {
  slug: string;
  name: string;
  parentName: string | null;
}

export interface SearchResults {
  query: string;
  products: SearchProductHit[];
  total: number;
  page: number;
  pageCount: number;
  brands: BrandHit[];
  categories: CategoryHit[];
  /** Spelling alternatives when nothing matched. */
  didYouMean: string[];
}

export interface Suggestion {
  products: {
    name: string;
    brandName: string;
    modelNumber: string | null;
    categoryName: string;
    categoryIcon: string | null;
    href: string;
    exact: boolean;
  }[];
  brands: { name: string; href: string }[];
  categories: { name: string; href: string }[];
}

/** Behind an interface so Postgres search can be swapped later without touching pages (SPEC §3). */
export interface SearchService {
  search(q: string, opts: CatalogOptions & { page?: number }): Promise<SearchResults>;
  suggest(q: string): Promise<Suggestion>;
}

type RankedRow = { id: string; exact: boolean; variant_code: string | null };

export class PostgresSearchService implements SearchService {
  constructor(private readonly db: DbOrTx) {}

  /**
   * Shared ranking query: exact identifiers, then full-text rank, then trigram similarity.
   * Candidates come from indexes only (identifier B-trees, the full-text GIN index and the
   * trigram GIN index on `search_text`), so the cost grows with the matches, not the catalogue.
   * The similarity scores are then computed for those candidates exactly as before.
   */
  private async rankProducts(q: string, limit: number, offset: number) {
    const folded = fold(q);
    const exact = q.trim();
    const tsq = buildPrefixTsQuery(q);
    const tsMatch = tsq ? sql`p.search_vector @@ to_tsquery('simple', ${tsq})` : sql`FALSE`;
    const tsRank = tsq ? sql`ts_rank(p.search_vector, to_tsquery('simple', ${tsq}))` : sql`0`;
    const candidates = sql`
      SELECT id FROM products WHERE lower(model_number) = lower(${exact}) OR lower(manufacturer_part_number) = lower(${exact})
      UNION SELECT product_id FROM product_variants WHERE barcode_gtin = ${exact} OR lower(manufacturer_part_number) = lower(${exact})
      UNION SELECT id FROM products WHERE ${tsq ? sql`search_vector @@ to_tsquery('simple', ${tsq})` : sql`FALSE`}
      -- word_similarity(q, brand + name) covers word_similarity(q, name): a longer text never scores lower.
      UNION SELECT id FROM products WHERE ${folded} <% search_text
      UNION SELECT id FROM products WHERE model_number % ${folded}`;
    const base = sql`
      FROM products p
      JOIN brands b ON b.id = p.brand_id AND b.is_active
      LEFT JOIN LATERAL (
        SELECT v.variant_code FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
          AND (v.barcode_gtin = ${exact} OR lower(v.manufacturer_part_number) = lower(${exact}))
        LIMIT 1
      ) vm ON TRUE
      CROSS JOIN LATERAL (
        SELECT (lower(p.model_number) = lower(${exact}) OR lower(p.manufacturer_part_number) = lower(${exact})
                OR vm.variant_code IS NOT NULL) AS exact,
               greatest(
                 word_similarity(${folded}, lower(sb_unaccent(p.name))),
                 word_similarity(${folded}, lower(sb_unaccent(b.name || ' ' || p.name))),
                 coalesce(similarity(${folded}, lower(p.model_number)), 0)
               ) AS sim
      ) m
      WHERE p.id IN (${candidates})
        AND p.publication_status = 'published'
        AND (m.exact OR ${tsMatch} OR m.sim >= ${FUZZY_THRESHOLD})`;
    // The trigram operators use these thresholds; set them below our own so the index returns a
    // superset of what the final filter keeps. SET LOCAL needs a transaction.
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(FUZZY_THRESHOLD)}, true),
                                  set_config('pg_trgm.similarity_threshold', ${String(FUZZY_THRESHOLD)}, true)`);
      const rows = await tx.execute<RankedRow>(sql`
        SELECT p.id, m.exact, vm.variant_code ${base}
        ORDER BY m.exact DESC, ${tsRank} DESC, m.sim DESC, p.name, p.id
        LIMIT ${limit} OFFSET ${offset}`);
      const [count] = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n ${base}`);
      return { rows: rows as unknown as RankedRow[], total: Number(count?.n ?? 0) };
    });
  }

  private async matchBrands(q: string, limit: number): Promise<BrandHit[]> {
    const folded = fold(q);
    const rows = await this.db.execute<{ slug: string; name: string; n: number }>(sql`
      SELECT b.slug, b.name,
             (SELECT count(*)::int FROM products p WHERE p.brand_id = b.id AND p.publication_status = 'published') AS n
      FROM brands b
      WHERE b.is_active AND (
        lower(sb_unaccent(b.name)) LIKE '%' || ${folded} || '%'
        OR word_similarity(${folded}, lower(sb_unaccent(b.name))) >= 0.5
        OR EXISTS (SELECT 1 FROM unnest(b.aliases) a WHERE lower(sb_unaccent(a)) LIKE '%' || ${folded} || '%')
      )
      ORDER BY (lower(sb_unaccent(b.name)) = ${folded}) DESC, word_similarity(${folded}, lower(sb_unaccent(b.name))) DESC, b.name
      LIMIT ${limit}`);
    return rows.map((r) => ({ slug: r.slug, name: r.name, productCount: Number(r.n) }));
  }

  private async matchCategories(q: string, limit: number): Promise<CategoryHit[]> {
    const folded = fold(q);
    const rows = await this.db.execute<{
      slug: string;
      name: string;
      parent_name: string | null;
    }>(sql`
      SELECT c.slug, c.name, pc.name AS parent_name
      FROM categories c LEFT JOIN categories pc ON pc.id = c.parent_id
      WHERE c.is_active AND (
        lower(sb_unaccent(c.name)) LIKE '%' || ${folded} || '%'
        OR word_similarity(${folded}, lower(sb_unaccent(c.name))) >= 0.5
        OR c.slug LIKE '%' || ${folded} || '%'
      )
      ORDER BY word_similarity(${folded}, lower(sb_unaccent(c.name))) DESC, c.sort_order
      LIMIT ${limit}`);
    return rows.map((r) => ({ slug: r.slug, name: r.name, parentName: r.parent_name }));
  }

  private async didYouMean(q: string): Promise<string[]> {
    const folded = fold(q);
    // Index-backed (trigram GIN on search_text) with the operator threshold set to our cut-off.
    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.word_similarity_threshold', '0.25', true)`);
      return tx.execute<{ term: string }>(sql`
        SELECT term FROM (
          SELECT b.name || ' ' || p.name AS term,
                 word_similarity(${folded}, lower(sb_unaccent(b.name || ' ' || p.name))) AS s
          FROM products p JOIN brands b ON b.id = p.brand_id
          WHERE p.publication_status = 'published' AND ${folded} <% p.search_text
          UNION ALL
          SELECT b.name, word_similarity(${folded}, lower(sb_unaccent(b.name))) FROM brands b WHERE b.is_active
        ) t
        WHERE s >= 0.25
        ORDER BY s DESC, term
        LIMIT 3`);
    });
    return rows.map((r) => r.term);
  }

  async search(q: string, opts: CatalogOptions & { page?: number }): Promise<SearchResults> {
    const query = q.trim().slice(0, 100);
    const page = Math.max(1, Math.min(opts.page ?? 1, 500));
    if (query.length < MIN_QUERY_LENGTH) {
      return {
        query,
        products: [],
        total: 0,
        page: 1,
        pageCount: 1,
        brands: [],
        categories: [],
        didYouMean: [],
      };
    }
    const [{ rows, total }, brands, categories] = await Promise.all([
      this.rankProducts(query, SEARCH_PAGE_SIZE, (page - 1) * SEARCH_PAGE_SIZE),
      this.matchBrands(query, 5),
      this.matchCategories(query, 5),
    ]);
    const cards = await getProductCards(
      this.db,
      rows.map((r) => r.id),
      opts,
    );
    const meta = new Map(rows.map((r) => [r.id, r]));
    const products: SearchProductHit[] = cards.map((c) => {
      const m = meta.get(c.id)!;
      return {
        ...c,
        exact: Boolean(m.exact),
        matchedVariantCode: m.variant_code,
        href: m.variant_code ? productHref(c.brand.slug, c.slug, m.variant_code) : c.href,
      };
    });
    const didYouMean = total === 0 && brands.length === 0 ? await this.didYouMean(query) : [];
    return {
      query,
      products,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
      brands,
      categories,
      didYouMean,
    };
  }

  async suggest(q: string): Promise<Suggestion> {
    const query = q.trim().slice(0, 100);
    if (query.length < MIN_QUERY_LENGTH) return { products: [], brands: [], categories: [] };
    const [{ rows }, brands, categories] = await Promise.all([
      this.rankProducts(query, SUGGEST_LIMIT, 0),
      this.matchBrands(query, 3),
      this.matchCategories(query, 3),
    ]);
    const ids = rows.map((r) => r.id);
    const details = ids.length
      ? await this.db.execute<{
          id: string;
          name: string;
          slug: string;
          model_number: string | null;
          brand_slug: string;
          brand_name: string;
          category_name: string;
          category_icon: string | null;
        }>(sql`
          SELECT p.id, p.name, p.slug, p.model_number, b.slug AS brand_slug, b.name AS brand_name,
                 c.name AS category_name, c.icon AS category_icon
          FROM products p JOIN brands b ON b.id = p.brand_id JOIN categories c ON c.id = p.category_id
          WHERE p.id = ANY(${sql.param(ids)}::uuid[])`)
      : [];
    const byId = new Map(details.map((d) => [d.id, d]));
    return {
      products: rows
        .map((r) => {
          const d = byId.get(r.id);
          if (!d) return null;
          return {
            name: d.name,
            brandName: d.brand_name,
            modelNumber: d.model_number,
            categoryName: d.category_name,
            categoryIcon: d.category_icon,
            href: productHref(d.brand_slug, d.slug, r.variant_code),
            exact: Boolean(r.exact),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
      brands: brands.map((b) => ({ name: b.name, href: `/brands/${b.slug}` })),
      categories: categories.map((c) => ({ name: c.name, href: `/categories/${c.slug}` })),
    };
  }
}
