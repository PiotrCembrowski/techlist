import type { Metadata } from "next";
import Link from "next/link";
import { FeaturedComparisons } from "@/components/compare/featured-comparisons";
import { CategoryIcon } from "@/components/product/image-placeholder";
import { ProductGrid } from "@/components/product/product-card";
import { SearchBox } from "@/components/search/search-box";
import { Blueprint } from "@/components/ui/blueprint";
import { Section } from "@/components/ui/section";
import { getCatalogOptions } from "@/lib/catalog-context";
import { getDb } from "@/lib/db";
import { formatDate, marketName } from "@/lib/format";
import {
  getCategoryTree,
  getHomeProductIds,
  listBrandsByProductCount,
} from "@/modules/catalog/pages";
import { getProductCards } from "@/modules/catalog/service";
import { listPublishedGuides } from "@/modules/guides/service";
import { listFeaturedComparisons } from "@/modules/comparisons/service";
import { getCatalogStats } from "@/modules/stats/service";
import { siteConfig } from "@/config/site";
import { getIndexability } from "@/modules/seo/indexability";
import { pageMetadata } from "@/modules/seo/metadata";
import { organizationAndWebsite } from "@/modules/seo/structured-data";
import { JsonLd } from "@/components/seo/json-ld";
import { getEnv } from "@/config/env";

const nf = new Intl.NumberFormat("en-GB");

export function generateMetadata(): Metadata {
  return {
    ...pageMetadata({
      title: `${siteConfig.name} — ${siteConfig.tagline}`,
      description: siteConfig.description,
      path: "/",
      indexability: getIndexability({ kind: "content" }),
    }),
    title: { absolute: `${siteConfig.name} — ${siteConfig.tagline}` },
  };
}

/**
 * Homepage (SPEC §7.1). Every section is backed by real data and omitted when empty.
 */
export default async function HomePage() {
  const db = getDb();
  const opts = await getCatalogOptions();
  const [stats, categories, { featuredIds, recentIds }, brands, guides, comparisons] =
    await Promise.all([
      getCatalogStats(db),
      getCategoryTree(db),
      getHomeProductIds(db, 8),
      listBrandsByProductCount(db, 12),
      listPublishedGuides(db, { limit: 3 }),
      listFeaturedComparisons(db, { limit: 3 }),
    ]);
  const [featured, recent] = await Promise.all([
    getProductCards(db, featuredIds, opts),
    getProductCards(db, recentIds, opts),
  ]);
  const cells = [
    { label: "Products", value: stats.products },
    { label: "Brands", value: stats.brands },
    { label: "Markets", value: stats.markets },
    { label: "Verified · 7 days", value: stats.verifiedLast7Days },
  ];
  const today = (formatDate(new Date()) ?? "").toUpperCase();
  const populated = categories.filter((c) => c.productCount > 0);

  return (
    <>
      <JsonLd data={organizationAndWebsite(getEnv().SITE_URL)} />
      <section aria-labelledby="hero-title" className="border-b">
        <div className="drafting-grid mx-auto grid max-w-[1280px] gap-10 px-4 pt-16 pb-14 sm:px-6 md:pt-20 lg:grid-cols-12 lg:gap-6 lg:px-10">
          <div className="flex flex-col gap-5 lg:col-span-8">
            <span className="text-xs font-medium tracking-[0.12em] text-primary uppercase">
              Global technology product database
            </span>
            <h1
              id="hero-title"
              className="text-5xl leading-[0.98] tracking-[-0.02em] sm:text-6xl lg:text-[76px]"
            >
              Discover. Compare. Choose smarter.
            </h1>
            <p className="max-w-[600px] text-lg text-pretty text-muted-foreground">
              Explore technology products, compare specifications and find offers from retailers
              around the world.
            </p>
            <SearchBox variant="hero" className="mt-3 max-w-[700px]" />
            {populated.length ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="mr-1 text-muted-foreground">Browse</span>
                {populated.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/categories/${c.slug}`}
                    className="flex min-h-11 items-center border px-3 font-medium hover:bg-accent sm:min-h-8"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <Blueprint
            as="aside"
            aria-label="Catalogue index"
            className="self-end bg-background lg:col-span-4"
          >
            <div className="flex justify-between border-b px-4 py-2.5 font-heading text-[13px] font-semibold tracking-[0.1em]">
              <span>INDEX</span>
              <span className="text-muted-foreground">REV. {today}</span>
            </div>
            <dl className="grid grid-cols-2">
              {cells.map((c, i) => (
                <div
                  key={c.label}
                  className={`p-4 ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b" : ""}`}
                >
                  <dt className="label-caps">{c.label}</dt>
                  <dd className="font-heading text-[40px] leading-[1.05] font-semibold">
                    {nf.format(c.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </Blueprint>
        </div>
      </section>

      {populated.length ? (
        <Section
          title="Categories"
          id="categories"
          action={{ href: "/categories", label: "All categories" }}
        >
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {populated.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/categories/${c.slug}`}
                  className="blueprint flex h-full flex-col gap-3 p-4 hover:bg-accent"
                >
                  <CategoryIcon name={c.icon} className="size-6 text-primary" />
                  <span className="font-heading text-lg leading-tight font-semibold">{c.name}</span>
                  <span className="mt-auto text-xs text-muted-foreground">
                    {nf.format(c.productCount)} products
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {featured.length ? (
        <Section
          title="Featured products"
          id="featured"
          action={{ href: "/products", label: "All products" }}
        >
          {opts.market !== "ALL" ? (
            <p className="-mt-2 text-sm text-muted-foreground">
              Prices shown for {marketName(opts.market)}, in the currency each retailer lists.
            </p>
          ) : null}
          <ProductGrid cards={featured} market={opts.market} />
        </Section>
      ) : null}

      {recent.length ? (
        <Section
          title="Recently added"
          id="recent"
          action={{ href: "/products", label: "Browse the catalogue" }}
        >
          <ProductGrid cards={recent} market={opts.market} />
        </Section>
      ) : null}

      {brands.length ? (
        <Section title="Brands" id="brands" action={{ href: "/brands", label: "All brands" }}>
          <ul className="grid grid-cols-2 border-t border-l sm:grid-cols-3 lg:grid-cols-6">
            {brands.map((b) => (
              <li key={b.slug} className="border-r border-b">
                <Link
                  href={`/brands/${b.slug}`}
                  className="flex h-full flex-col gap-1 p-4 hover:bg-accent"
                >
                  <span className="font-heading text-xl font-semibold tracking-[0.04em] uppercase">
                    {b.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{b.productCount} products</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {comparisons.length ? <FeaturedComparisons items={comparisons} /> : null}

      {guides.length ? (
        <Section
          title="Latest guides"
          id="guides"
          action={{ href: "/guides", label: "All guides" }}
        >
          <ul className="grid gap-6 md:grid-cols-3">
            {guides.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/guides/${g.slug}`}
                  className="blueprint flex h-full flex-col gap-2 p-5 hover:bg-accent"
                >
                  <span className="label-caps">{formatDate(g.publishedAt)}</span>
                  <span className="font-heading text-2xl leading-tight font-semibold">
                    {g.title}
                  </span>
                  {g.summary ? (
                    <span className="text-sm text-muted-foreground">{g.summary}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
