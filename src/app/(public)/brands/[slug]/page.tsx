import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { getIndexability } from "@/modules/seo/indexability";
import { emitsStructuredData, pageMetadata } from "@/modules/seo/metadata";
import { breadcrumbList } from "@/modules/seo/structured-data";
import { JsonLd } from "@/components/seo/json-ld";
import { getEnv } from "@/config/env";
import { countIndexableProducts } from "@/modules/seo/queries";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { FeaturedComparisons } from "@/components/compare/featured-comparisons";
import { DemoTag } from "@/components/product/demo-tag";
import { ProductGrid } from "@/components/product/product-card";
import { Blueprint } from "@/components/ui/blueprint";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container, Section } from "@/components/ui/section";
import { getCatalogOptions } from "@/lib/catalog-context";
import { getDb } from "@/lib/db";
import { marketName } from "@/lib/format";
import { getBrandPageData } from "@/modules/catalog/pages";
import { mediaUrl } from "@/modules/media/public";
import { getProductCards } from "@/modules/catalog/service";
import { listFeaturedComparisons } from "@/modules/comparisons/service";

type Props = { params: Promise<{ slug: string }> };

const load = cache((slug: string) => getBrandPageData(getDb(), slug));
const indexableOf = cache(async (slug: string) => {
  const page = await load(slug);
  return page.kind === "ok" ? countIndexableProducts(getDb(), { brandId: page.data.brand.id }) : 0;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await load((await params).slug);
  if (page.kind !== "ok") return {};
  const { brand } = page.data;
  const indexableProducts = await indexableOf(brand.slug);
  return pageMetadata({
    title: brand.name,
    description: brand.description ?? `${brand.name} products with structured specifications.`,
    path: `/brands/${brand.slug}`,
    indexability: getIndexability({
      kind: "brand",
      isActive: true,
      isDemo: brand.isDemo,
      indexableProducts,
    }),
    images: brand.logoImageKey
      ? [{ url: mediaUrl(brand.logoImageKey), alt: `${brand.name} logo` }]
      : undefined,
  });
}

export default async function BrandPage({ params }: Props) {
  const page = await load((await params).slug);
  if (page.kind === "redirect") permanentRedirect(page.to);
  if (page.kind === "not_found") notFound();
  const { brand, categories, families, latestIds, discontinuedIds, productCount } = page.data;
  const crumbs = [
    { label: "Home", href: "/" },
    { label: "Brands", href: "/brands" },
    { label: brand.name },
  ];
  const db = getDb();
  const opts = await getCatalogOptions();
  const [latest, discontinued, comparisons] = await Promise.all([
    getProductCards(db, latestIds, opts),
    getProductCards(db, discontinuedIds, opts),
    listFeaturedComparisons(db, { brandId: brand.id, limit: 6 }),
  ]);
  const monogram = brand.name.slice(0, 2).toUpperCase();

  return (
    <>
      <Container className="flex flex-col gap-8 pt-10">
        {emitsStructuredData(
          getIndexability({
            kind: "brand",
            isActive: true,
            isDemo: brand.isDemo,
            indexableProducts: await indexableOf(brand.slug),
          }),
        ) ? (
          <JsonLd data={breadcrumbList(getEnv().SITE_URL, crumbs, `/brands/${brand.slug}`)} />
        ) : null}
        <Breadcrumbs items={crumbs} />
        <div className="grid gap-8 md:grid-cols-[160px_minmax(0,1fr)]">
          {brand.logoImageKey ? (
            <Blueprint className="flex aspect-square items-center justify-center bg-background p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl(brand.logoImageKey)}
                alt={`${brand.name} logo`}
                className="max-h-full max-w-full object-contain"
              />
            </Blueprint>
          ) : (
            /* No licensed logo yet: a neutral monogram plate, labelled as such. */
            <Blueprint
              className="flex aspect-square items-center justify-center bg-muted"
              role="img"
              aria-label={`${brand.name}: no licensed logo`}
            >
              <span className="font-heading text-5xl font-semibold tracking-[0.04em] text-muted-foreground">
                {monogram}
              </span>
            </Blueprint>
          )}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium tracking-[0.12em] text-primary uppercase">
                Brand
              </span>
              {brand.isDemo ? <DemoTag /> : null}
            </div>
            <h1 className="text-6xl leading-none tracking-[0.02em] uppercase">{brand.name}</h1>
            {brand.description ? (
              <p className="max-w-[640px] text-muted-foreground">{brand.description}</p>
            ) : null}
            <dl className="flex w-fit flex-wrap border text-[13px]">
              <div className="border-r px-3 py-1.5">
                <dt className="sr-only">Products</dt>
                <dd>
                  <span className="text-muted-foreground">Products </span>
                  {productCount}
                </dd>
              </div>
              {brand.countryOfOrigin ? (
                <div className="border-r px-3 py-1.5">
                  <dt className="sr-only">Country of origin</dt>
                  <dd>
                    <span className="text-muted-foreground">Origin </span>
                    {marketName(brand.countryOfOrigin)}
                  </dd>
                </div>
              ) : null}
              {brand.officialWebsiteUrl ? (
                <div className="px-3 py-1.5">
                  <dt className="sr-only">Official website</dt>
                  <dd>
                    <a
                      href={brand.officialWebsiteUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                      className="inline-flex items-center gap-1 text-primary"
                    >
                      Official website{" "}
                      <ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3.5" />
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
            {categories.length ? (
              <nav
                aria-label={`${brand.name} categories`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                {categories.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/products?category=${c.slug}&brand=${brand.slug}`}
                    className="flex min-h-11 items-center gap-2 border px-3 hover:bg-accent sm:min-h-8"
                  >
                    {c.name}
                    <span className="text-xs text-muted-foreground">{c.productCount}</span>
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
        </div>
      </Container>

      {families.length ? (
        <Section title="Product families" id="families">
          <ul className="flex flex-wrap gap-2">
            {families.map((f) => (
              <li key={f.slug} className="border px-3 py-1.5 text-sm">
                {f.name}{" "}
                <span className="text-xs text-muted-foreground">· {f.productCount} models</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {latest.length ? (
        <Section
          title="Latest models"
          id="latest"
          action={{ href: `/products?brand=${brand.slug}`, label: `All ${brand.name} products` }}
        >
          <ProductGrid cards={latest} market={opts.market} />
        </Section>
      ) : null}

      {discontinued.length ? (
        <Section title="Discontinued models" id="discontinued">
          <ProductGrid cards={discontinued} market={opts.market} />
        </Section>
      ) : null}
      {comparisons.length ? (
        <FeaturedComparisons items={comparisons} title={`Comparisons with ${brand.name}`} />
      ) : null}
    </>
  );
}
