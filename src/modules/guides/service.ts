import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { resolveSlugRedirect } from "@/modules/slugs/service";

export interface GuideSummary {
  slug: string;
  title: string;
  summary: string | null;
  authorName: string | null;
  publishedAt: Date | null;
  isDemo: boolean;
}

export interface GuideDetail extends GuideSummary {
  bodyMarkdown: string;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: Date | null;
  products: { slug: string; name: string; brandSlug: string; brandName: string }[];
  categories: { slug: string; name: string }[];
}

type GuideRow = {
  slug: string;
  title: string;
  summary: string | null;
  author_name: string | null;
  published_at: string | null;
  is_demo: boolean;
};

const toSummary = (r: GuideRow): GuideSummary => ({
  slug: r.slug,
  title: r.title,
  summary: r.summary,
  authorName: r.author_name,
  publishedAt: r.published_at ? new Date(r.published_at) : null,
  isDemo: r.is_demo,
});

const PUBLISHED = sql`g.publication_status = 'published' AND (g.published_at IS NULL OR g.published_at <= now())`;

export async function listPublishedGuides(
  db: DbOrTx,
  opts: { limit?: number; offset?: number } = {},
) {
  const limit = Math.min(Math.max(1, opts.limit ?? 24), 48);
  const rows = await db.execute<GuideRow>(sql`
    SELECT g.slug, g.title, g.summary, g.author_name, g.published_at::text, g.is_demo FROM guides g
    WHERE ${PUBLISHED} ORDER BY g.published_at DESC NULLS LAST, g.title
    LIMIT ${limit} OFFSET ${Math.max(0, opts.offset ?? 0)}`);
  return rows.map(toSummary);
}

export async function listGuidesForCategories(
  db: DbOrTx,
  categoryIds: string[],
  limit = 3,
): Promise<GuideSummary[]> {
  if (!categoryIds.length) return [];
  const rows = await db.execute<GuideRow>(sql`
    SELECT DISTINCT g.slug, g.title, g.summary, g.author_name, g.published_at::text, g.is_demo FROM guides g
    JOIN guide_categories gc ON gc.guide_id = g.id
    WHERE ${PUBLISHED} AND gc.category_id = ANY(${sql.param(categoryIds)}::uuid[])
    ORDER BY 5 DESC NULLS LAST, 2 LIMIT ${Math.min(limit, 12)}`);
  return rows.map(toSummary);
}

export async function listGuidesForProduct(
  db: DbOrTx,
  productId: string,
  categoryIds: string[],
  limit = 3,
): Promise<GuideSummary[]> {
  const rows = await db.execute<GuideRow>(sql`
    SELECT g.slug, g.title, g.summary, g.author_name, g.published_at::text, g.is_demo FROM guides g
    WHERE ${PUBLISHED} AND (
      EXISTS (SELECT 1 FROM guide_products gp WHERE gp.guide_id = g.id AND gp.product_id = ${productId})
      OR EXISTS (SELECT 1 FROM guide_categories gc WHERE gc.guide_id = g.id AND gc.category_id = ANY(${sql.param(categoryIds)}::uuid[]))
    )
    ORDER BY EXISTS (SELECT 1 FROM guide_products gp WHERE gp.guide_id = g.id AND gp.product_id = ${productId}) DESC,
             g.published_at DESC NULLS LAST
    LIMIT ${Math.min(limit, 12)}`);
  return rows.map(toSummary);
}

export async function getPublishedGuide(
  db: DbOrTx,
  slug: string,
): Promise<
  { kind: "ok"; guide: GuideDetail } | { kind: "redirect"; to: string } | { kind: "not_found" }
> {
  const [row] = await db.execute<
    GuideRow & {
      id: string;
      body_markdown: string;
      seo_title: string | null;
      seo_description: string | null;
      updated_at: string | null;
    }
  >(sql`
    SELECT g.id, g.slug, g.title, g.summary, g.author_name, g.published_at::text, g.is_demo, g.body_markdown, g.seo_title, g.seo_description,
           g.updated_at::text
    FROM guides g WHERE g.slug = ${slug} AND ${PUBLISHED}`);
  if (!row) {
    const to = await resolveSlugRedirect(db, "guide", slug);
    return to ? { kind: "redirect", to: `/guides/${to}` } : { kind: "not_found" };
  }
  const [products, categories] = await Promise.all([
    db.execute<{ slug: string; name: string; brand_slug: string; brand_name: string }>(sql`
      SELECT p.slug, p.name, b.slug AS brand_slug, b.name AS brand_name FROM guide_products gp
      JOIN products p ON p.id = gp.product_id AND p.publication_status = 'published'
      JOIN brands b ON b.id = p.brand_id
      WHERE gp.guide_id = ${row.id} ORDER BY p.name LIMIT 24`),
    db.execute<{ slug: string; name: string }>(sql`
      SELECT c.slug, c.name FROM guide_categories gc JOIN categories c ON c.id = gc.category_id AND c.is_active
      WHERE gc.guide_id = ${row.id} ORDER BY c.sort_order LIMIT 12`),
  ]);
  return {
    kind: "ok",
    guide: {
      ...toSummary(row),
      bodyMarkdown: row.body_markdown,
      seoTitle: row.seo_title,
      seoDescription: row.seo_description,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
      products: products.map((p) => ({
        slug: p.slug,
        name: p.name,
        brandSlug: p.brand_slug,
        brandName: p.brand_name,
      })),
      categories: categories.map((c) => ({ slug: c.slug, name: c.name })),
    },
  };
}
