import type { Metadata } from "next";
import { getIndexability } from "@/modules/seo/indexability";
import { emitsStructuredData, pageMetadata } from "@/modules/seo/metadata";
import { breadcrumbList } from "@/modules/seo/structured-data";
import { JsonLd } from "@/components/seo/json-ld";
import { getEnv } from "@/config/env";
import { countIndexableProducts } from "@/modules/seo/queries";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { cache } from "react";
import { CatalogView, hasEmptyParams } from "@/components/catalog/catalog-view";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getCatalogOptions } from "@/lib/catalog-context";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import {
  catalogQueryString,
  isFiltered,
  parseCatalogFilters,
  type RawSearchParams,
} from "@/modules/catalog/filters";
import { getCategoryPageData } from "@/modules/catalog/pages";
import { getFilterRanges, listCatalog } from "@/modules/catalog/service";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> };

const load = cache((slug: string) => getCategoryPageData(getDb(), slug));
const indexableIn = cache(async (slug: string) => {
  const page = await load(slug);
  return page.kind === "ok"
    ? countIndexableProducts(getDb(), { categoryIds: page.data.scopeIds })
    : 0;
});

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await load(slug);
  if (page.kind !== "ok") return {};
  const { category, filterable } = page.data;
  const filtered = isFiltered(parseCatalogFilters(await searchParams, filterable));
  const indexableProducts = await indexableIn(slug);
  return pageMetadata({
    title: category.seoTitle ?? category.name,
    description:
      category.seoDescription ??
      category.description ??
      `${category.name}: specifications, comparisons and offers.`,
    // Filtered views are noindex, follow, with the unfiltered page as canonical.
    path: `/categories/${category.slug}`,
    indexability: getIndexability({
      kind: "category",
      isActive: category.isActive,
      filtered,
      indexableProducts,
    }),
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const raw = await searchParams;
  const page = await load(slug);
  if (page.kind === "redirect") permanentRedirect(page.to);
  if (page.kind === "not_found") notFound();
  const data = page.data;
  const path = `/categories/${data.category.slug}`;
  const filters = parseCatalogFilters(raw, data.filterable);
  if (hasEmptyParams(raw)) redirect(`${path}${catalogQueryString(filters)}`);
  const crumbs = [
    { label: "Home", href: "/" },
    { label: "Categories", href: "/categories" },
    ...data.ancestors.map((a) => ({ label: a.name, href: `/categories/${a.slug}` })),
    { label: data.category.name },
  ];
  const structured = emitsStructuredData(
    getIndexability({
      kind: "category",
      isActive: true,
      filtered: isFiltered(filters),
      indexableProducts: await indexableIn(slug),
    }),
  );

  const db = getDb();
  const opts = await getCatalogOptions();
  const numericIds = data.filterable
    .filter((d) => d.dataType === "integer" || d.dataType === "decimal")
    .map((d) => d.id);
  const [result, ranges] = await Promise.all([
    listCatalog(db, { categoryIds: data.scopeIds }, filters, opts),
    getFilterRanges(db, data.scopeIds, numericIds),
  ]);

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        {structured ? <JsonLd data={breadcrumbList(getEnv().SITE_URL, crumbs, path)} /> : null}
        <Breadcrumbs items={crumbs} />
        <h1 className="text-5xl">{data.category.name}</h1>
        {data.category.description ? (
          <p className="max-w-[640px] text-muted-foreground">{data.category.description}</p>
        ) : null}
        {data.children.length ? (
          <nav aria-label="Subcategories" className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Subcategories</span>
            {data.children.map((c) => (
              <Link
                key={c.slug}
                href={`/categories/${c.slug}`}
                className="flex min-h-11 items-center gap-2 border px-3 hover:bg-accent sm:min-h-8"
              >
                {c.name}
                <span className="text-xs text-muted-foreground">{c.productCount}</span>
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <CatalogView
        path={path}
        filters={filters}
        result={result}
        market={opts.market}
        filterProps={{
          definitions: data.filterable,
          ranges,
          brands: data.brands,
          priceCurrency: opts.priceCurrency ?? null,
        }}
      />

      {data.brands.length || data.guides.length ? (
        <div className="grid gap-8 border-t pt-8 md:grid-cols-2">
          {data.brands.length ? (
            <section aria-labelledby="cat-brands">
              <h2 id="cat-brands" className="mb-3 text-2xl">
                Brands in {data.category.name}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {data.brands.map((b) => (
                  <li key={b.slug}>
                    <Link
                      href={`/brands/${b.slug}`}
                      className="flex min-h-11 items-center gap-2 border px-3 text-sm hover:bg-accent sm:min-h-8"
                    >
                      {b.name}
                      <span className="text-xs text-muted-foreground">{b.productCount}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.guides.length ? (
            <section aria-labelledby="cat-guides">
              <h2 id="cat-guides" className="mb-3 text-2xl">
                Related guides
              </h2>
              <ul className="flex flex-col gap-2">
                {data.guides.map((g) => (
                  <li key={g.slug} className="flex flex-col border-t pt-2">
                    <Link
                      href={`/guides/${g.slug}`}
                      className="font-medium text-primary hover:text-primary-active"
                    >
                      {g.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(g.publishedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Container>
  );
}
