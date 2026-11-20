import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { CompareToggle } from "@/components/compare/compare-toggle";
import { OfferList } from "@/components/offers/offer-list";
import { DemoTag } from "@/components/product/demo-tag";
import { ImagePlaceholder } from "@/components/product/image-placeholder";
import { ProductGrid } from "@/components/product/product-card";
import { SpecTable } from "@/components/product/spec-table";
import { VerificationBadge } from "@/components/product/verification-badge";
import { Blueprint } from "@/components/ui/blueprint";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getCatalogOptions } from "@/lib/catalog-context";
import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { formatDate, marketName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getProductCards, productHref } from "@/modules/catalog/service";
import { groupOffers } from "@/modules/offers/display";
import { getProductOffers } from "@/modules/offers/read";
import { loadProductPage, type RelatedLink } from "@/modules/products/public";

type Props = {
  params: Promise<{ brandSlug: string; productSlug: string }>;
  searchParams: Promise<{ variant?: string | string[] }>;
};

const load = cache((brand: string, product: string, variant: string | null) =>
  loadProductPage(getDb(), brand, product, variant),
);

async function resolve(props: Props) {
  const { brandSlug, productSlug } = await props.params;
  const v = (await props.searchParams).variant;
  return load(brandSlug, productSlug, typeof v === "string" ? v : null);
}

const STATUS: Record<string, { label: string; className: string }> = {
  announced: { label: "Announced", className: "text-foreground" },
  active: { label: "Available", className: "text-success" },
  discontinued: { label: "Discontinued", className: "text-muted-foreground" },
};

const SOURCE_TYPE: Record<string, string> = {
  manufacturer: "Manufacturer documentation",
  licensed_provider: "Licensed data provider",
  retailer: "Retailer",
  affiliate_network: "Affiliate network",
  manual_research: "Manual research",
  ai_extraction: "AI-assisted extraction (reviewed)",
  community_submission: "Community correction (reviewed)",
};

const LINK_LABEL: Record<string, string> = {
  official: "Official product page",
  support: "Support",
  manual: "Manual",
  driver: "Drivers",
  spec_sheet: "Specification sheet",
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const page = await resolve(props);
  if (page.kind !== "ok") return {};
  const { product, brand } = page.data;
  const title = product.seoTitle ?? `${brand.name} ${product.name} specifications`;
  return {
    title,
    description:
      product.seoDescription ??
      product.shortDescription ??
      `${brand.name} ${product.name}${product.modelNumber ? ` (${product.modelNumber})` : ""}: structured, sourced specifications.`,
    // Variants share the product's canonical URL.
    alternates: { canonical: productHref(brand.slug, product.slug) },
    ...(product.isDemo ? { robots: { index: false, follow: false } } : {}),
  };
}

function RelatedList({ title, items }: { title: string; items: RelatedLink[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="label-caps">{title}</span>
      {items.map((r) => (
        <Link
          key={r.slug}
          href={r.href}
          className="font-medium text-primary hover:text-primary-active"
        >
          {r.brandName} {r.name}
          {r.releaseDate ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {r.releaseDate.slice(0, 4)}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

export default async function ProductPage(props: Props) {
  const page = await resolve(props);
  if (page.kind === "redirect") permanentRedirect(page.to);
  if (page.kind === "not_found") notFound();
  const d = page.data;
  const { product, brand } = d;
  const category = d.categoryChain[d.categoryChain.length - 1];
  const db = getDb();
  const opts = await getCatalogOptions();
  const [alternatives, related, offerRows] = await Promise.all([
    getProductCards(db, d.alternativeIds, opts),
    getProductCards(db, d.relatedIds, opts),
    getProductOffers(db, d.product.id, d.selectedVariant?.id ?? null),
  ]);
  const now = new Date();
  const staleHours = getEnv().OFFER_STALE_HOURS;
  const offers = groupOffers(offerRows, opts.market, staleHours, now);
  const primaryCount = offers.primary.reduce((n, g) => n + g.fresh.length + g.stale.length, 0);
  const status = STATUS[product.productStatus];
  const base = productHref(brand.slug, product.slug);
  const defaultVariant = d.variants.find((v) => v.isDefault) ?? null;
  const current = d.selectedVariant ?? defaultVariant;

  return (
    <Container className="flex flex-col gap-10 py-8">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          ...d.categoryChain.map((c) => ({ label: c.name, href: `/categories/${c.slug}` })),
          { label: brand.name, href: `/brands/${brand.slug}` },
          { label: product.name },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Blueprint className="overflow-visible">
            <ImagePlaceholder
              icon={category?.icon}
              className="aspect-square"
              iconClassName="size-16"
            />
          </Blueprint>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-medium tracking-[0.1em] text-primary uppercase">
              <Link href={`/brands/${brand.slug}`} className="hover:text-primary-active">
                {brand.name}
              </Link>{" "}
              · {category?.name}
            </span>
            {product.isDemo ? <DemoTag /> : null}
          </div>
          <h1 className="text-5xl leading-none sm:text-6xl">{product.name}</h1>

          <dl className="flex w-fit max-w-full flex-wrap border text-[13px]">
            {product.modelNumber ? (
              <div className="border-r border-b px-3 py-1.5 sm:border-b-0">
                <dt className="inline text-muted-foreground">Model </dt>
                <dd className="model-number inline font-semibold">{product.modelNumber}</dd>
              </div>
            ) : null}
            {product.releaseDate ? (
              <div className="border-r border-b px-3 py-1.5 sm:border-b-0">
                <dt className="inline text-muted-foreground">Released </dt>
                <dd className="inline">{formatDate(product.releaseDate)}</dd>
              </div>
            ) : product.announcedDate ? (
              <div className="border-r border-b px-3 py-1.5 sm:border-b-0">
                <dt className="inline text-muted-foreground">Announced </dt>
                <dd className="inline">{formatDate(product.announcedDate)}</dd>
              </div>
            ) : null}
            {product.discontinuedDate ? (
              <div className="border-r border-b px-3 py-1.5 sm:border-b-0">
                <dt className="inline text-muted-foreground">Discontinued </dt>
                <dd className="inline">{formatDate(product.discontinuedDate)}</dd>
              </div>
            ) : null}
            {status ? (
              <div className={cn("border-r border-b px-3 py-1.5 sm:border-b-0", status.className)}>
                <dt className="sr-only">Status</dt>
                <dd>{status.label}</dd>
              </div>
            ) : null}
            <div className="flex items-center gap-2 px-3 py-1.5">
              <dt className="sr-only">Verification</dt>
              <dd className="flex items-center gap-2">
                <VerificationBadge
                  status={product.verificationStatus}
                  verifiedAt={product.lastVerifiedAt}
                  linkToPolicy
                />
                {d.sources.length ? (
                  <a href="#sources" className="text-primary">
                    {d.sources.length} {d.sources.length === 1 ? "source" : "sources"}
                  </a>
                ) : null}
              </dd>
            </div>
          </dl>

          {product.shortDescription ? (
            <p className="max-w-[640px] text-pretty text-muted-foreground">
              {product.shortDescription}
            </p>
          ) : null}

          {d.variants.length > 1 ? (
            <nav aria-label="Variants" className="flex flex-col gap-1.5">
              <span className="label-caps">Variant</span>
              <ul className="flex w-fit max-w-full flex-wrap border">
                {d.variants.map((v, i) => {
                  const selected = current?.id === v.id;
                  return (
                    <li key={v.id} className={cn(i > 0 && "border-l")}>
                      <Link
                        href={
                          v.isDefault
                            ? base
                            : `${base}?variant=${encodeURIComponent(v.variantCode)}`
                        }
                        aria-current={selected ? "true" : undefined}
                        scroll={false}
                        className={cn(
                          "flex min-h-11 items-center px-3 text-[13px] sm:min-h-9",
                          selected ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                        )}
                      >
                        {v.variantName}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {current && (current.regionCode || current.color) ? (
                <span className="text-xs text-muted-foreground">
                  {[current.regionCode ? `Region ${current.regionCode}` : null, current.color]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
            </nav>
          ) : null}

          {d.keySpecs.length ? (
            <dl
              aria-label="Key specifications"
              className="grid grid-cols-2 border-t border-l sm:grid-cols-3"
            >
              {d.keySpecs.map((s) => (
                <div key={s.key} className="flex flex-col gap-0.5 border-r border-b px-3.5 py-3">
                  <dt className="label-caps">{s.label}</dt>
                  <dd className="font-heading text-2xl leading-tight font-semibold break-words">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="flex flex-wrap gap-2.5">
            {primaryCount ? (
              <a
                href="#offers"
                className="blueprint inline-flex h-11 items-center border-primary bg-primary px-[22px] font-heading text-[15px] font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                See {primaryCount} {primaryCount === 1 ? "offer" : "offers"}
                {opts.market !== "ALL" ? ` in ${marketName(opts.market)}` : ""}
              </a>
            ) : null}
            <CompareToggle
              variant="button"
              item={{
                slug: product.slug,
                name: product.name,
                brandName: brand.name,
                href: base,
                topCategorySlug: d.categoryChain[0]?.slug ?? category?.slug ?? "",
                topCategoryName: d.categoryChain[0]?.name ?? category?.name ?? "",
                icon: category?.icon ?? null,
              }}
            />
          </div>

          {d.predecessors.length || d.successors.length ? (
            <div className="flex flex-wrap gap-8 text-sm">
              <RelatedList title="Predecessor" items={d.predecessors} />
              <RelatedList title="Successor" items={d.successors} />
            </div>
          ) : null}
        </div>
      </div>

      <OfferList
        offers={offers}
        market={opts.market}
        staleHours={staleHours}
        showVariant={!d.selectedVariant}
        now={now}
      />

      <div className="grid gap-10 lg:grid-cols-12">
        <section aria-labelledby="specs" className="lg:col-span-8">
          <h2 id="specs" className="mb-5 text-[28px]">
            Specifications
          </h2>
          <SpecTable groups={d.specGroups} />
        </section>

        <aside className="flex flex-col gap-8 lg:col-span-4">
          <section
            id="sources"
            aria-labelledby="sources-title"
            className="blueprint flex flex-col gap-3 p-5"
          >
            <h2 id="sources-title" className="text-xl">
              Data sources
            </h2>
            <VerificationBadge
              status={product.verificationStatus}
              verifiedAt={product.lastVerifiedAt}
              framed
              className="w-fit"
            />
            {d.sources.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {d.sources.map((s) => (
                  <li key={s.name} className="border-t pt-2">
                    <span className="font-medium">{s.name}</span>
                    {s.isDemo ? <DemoTag className="ml-2" /> : null}
                    <span className="block text-xs text-muted-foreground">
                      {SOURCE_TYPE[s.type] ?? s.type}
                      {s.retrievedAt ? ` · retrieved ${formatDate(s.retrievedAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No sources have been recorded for this product yet.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {d.requiredCoverage.required > 0
                ? `${d.requiredCoverage.present} of ${d.requiredCoverage.required} core specifications recorded. `
                : ""}
              Values marked &ldquo;unverified&rdquo; have not yet been matched to a source.{" "}
              <Link href="/data-policy" className="text-primary">
                How we verify data
              </Link>
            </p>
          </section>

          {d.links.length ? (
            <section aria-labelledby="links-title" className="flex flex-col gap-2">
              <h2 id="links-title" className="text-xl">
                Manufacturer links
              </h2>
              {d.links.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="inline-flex items-center gap-1.5 text-sm text-primary"
                >
                  {LINK_LABEL[l.type] ?? l.type}
                  <ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3.5" />
                </a>
              ))}
            </section>
          ) : null}

          {d.guides.length ? (
            <section aria-labelledby="guides-title" className="flex flex-col gap-2">
              <h2 id="guides-title" className="text-xl">
                Related guides
              </h2>
              {d.guides.map((g) => (
                <Link
                  key={g.slug}
                  href={`/guides/${g.slug}`}
                  className="border-t pt-2 text-sm font-medium text-primary hover:text-primary-active"
                >
                  {g.title}
                </Link>
              ))}
            </section>
          ) : null}
        </aside>
      </div>

      {alternatives.length ? (
        <section aria-labelledby="alternatives" className="flex flex-col gap-5">
          <h2 id="alternatives" className="border-b border-border-strong pb-2.5 text-[28px]">
            Alternatives
          </h2>
          <ProductGrid cards={alternatives} market={opts.market} />
        </section>
      ) : null}

      {related.length ? (
        <section aria-labelledby="related" className="flex flex-col gap-5">
          <h2 id="related" className="border-b border-border-strong pb-2.5 text-[28px]">
            Related products
          </h2>
          <ProductGrid cards={related} market={opts.market} />
        </section>
      ) : null}
    </Container>
  );
}
