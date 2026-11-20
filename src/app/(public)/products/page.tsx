import type { Metadata } from "next";
import { getIndexability } from "@/modules/seo/indexability";
import { pageMetadata } from "@/modules/seo/metadata";
import { countIndexableProducts } from "@/modules/seo/queries";
import { redirect } from "next/navigation";
import { CatalogView, hasEmptyParams } from "@/components/catalog/catalog-view";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getCatalogOptions } from "@/lib/catalog-context";
import { getDb } from "@/lib/db";
import {
  catalogQueryString,
  isFiltered,
  parseCatalogFilters,
  type RawSearchParams,
} from "@/modules/catalog/filters";
import {
  getCategoryPageData,
  getCategoryTree,
  listBrandsByProductCount,
} from "@/modules/catalog/pages";
import { getFilterRanges, listCatalog } from "@/modules/catalog/service";

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const raw = await searchParams;
  const filtered = isFiltered(parseCatalogFilters(raw)) || Boolean(raw.category);
  const count = await countIndexableProducts(getDb(), {});
  return pageMetadata({
    title: "All products",
    description: "Browse every product in the catalogue by category, brand, status and price.",
    path: "/products",
    indexability: getIndexability({ kind: "listing", filtered, itemCount: count }),
  });
}

export default async function ProductsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const db = getDb();
  const opts = await getCatalogOptions();
  const categorySlug = typeof raw.category === "string" && raw.category ? raw.category : null;
  const categoryData = categorySlug ? await getCategoryPageData(db, categorySlug) : null;
  const category = categoryData?.kind === "ok" ? categoryData.data : null;
  const filterable = category?.filterable ?? [];
  const filters = parseCatalogFilters(raw, filterable);
  const extraQuery: Record<string, string> = category ? { category: category.category.slug } : {};

  if (hasEmptyParams(raw)) {
    const qs = catalogQueryString(filters);
    const extra = new URLSearchParams(extraQuery).toString();
    redirect(`/products${extra ? (qs ? `${qs}&${extra}` : `?${extra}`) : qs}`);
  }

  const [result, tree, brands, ranges] = await Promise.all([
    listCatalog(db, { categoryIds: category?.scopeIds }, filters, opts),
    getCategoryTree(db),
    category ? Promise.resolve(category.brands) : listBrandsByProductCount(db, 50),
    getFilterRanges(
      db,
      category?.scopeIds ?? [],
      filterable
        .filter((d) => d.dataType === "integer" || d.dataType === "decimal")
        .map((d) => d.id),
    ),
  ]);
  const categoryOptions = tree.flatMap((c) => [
    { slug: c.slug, name: c.name },
    ...c.children.map((ch) => ({ slug: ch.slug, name: `— ${ch.name}` })),
  ]);

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "All products" }]} />
        <h1 className="text-5xl">All products</h1>
        <p className="max-w-[640px] text-muted-foreground">
          Every published product. Choose a category to filter by its specifications.
        </p>
      </div>
      <CatalogView
        path="/products"
        filters={filters}
        result={result}
        market={opts.market}
        extraQuery={extraQuery}
        filterProps={{
          definitions: filterable,
          ranges,
          brands,
          priceCurrency: opts.priceCurrency ?? null,
          categories: categoryOptions,
          selectedCategory: category?.category.slug ?? null,
          showQuery: true,
        }}
      />
    </Container>
  );
}
