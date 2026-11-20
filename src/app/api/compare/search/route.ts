import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { clientAddress, PostgresRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { slugSchema } from "@/lib/validation";
import { parseCatalogFilters } from "@/modules/catalog/filters";
import { getCategoryPageData } from "@/modules/catalog/pages";
import { listCatalog } from "@/modules/catalog/service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
  category: slugSchema.optional(),
});

/** Product picker for comparisons: up to 8 published products, optionally within one category tree. */
export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse({
    q: req.nextUrl.searchParams.get("q") ?? "",
    category: req.nextUrl.searchParams.get("category") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ items: [] }, { status: 400 });

  const db = getDb();
  const limit = await new PostgresRateLimiter(db).consume(
    rateLimitKey("compare-search", clientAddress(req.headers)),
    60,
    60,
  );
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let categoryIds: string[] | undefined;
  if (parsed.data.category) {
    const page = await getCategoryPageData(db, parsed.data.category);
    if (page.kind !== "ok") return NextResponse.json({ items: [] });
    categoryIds = page.data.scopeIds;
  }
  const result = await listCatalog(
    db,
    { categoryIds },
    parseCatalogFilters({ q: parsed.data.q, sort: "name" }),
    {
      market: "ALL",
      staleHours: getEnv().OFFER_STALE_HOURS,
      pageSize: 8,
    },
  );
  return NextResponse.json(
    {
      items: result.items.map((c) => ({
        slug: c.slug,
        name: c.name,
        brandName: c.brand.name,
        href: c.href,
        modelNumber: c.modelNumber,
        topCategorySlug: c.topCategory.slug,
        topCategoryName: c.topCategory.name,
        icon: c.category.icon,
      })),
    },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
