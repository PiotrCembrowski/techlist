import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/catalog/pagination";
import { DemoTag } from "@/components/product/demo-tag";
import { ImagePlaceholder } from "@/components/product/image-placeholder";
import { VerificationBadge } from "@/components/product/verification-badge";
import { Highlighted } from "@/components/search/highlighted";
import { SearchBox } from "@/components/search/search-box";
import { Blueprint } from "@/components/ui/blueprint";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getCatalogOptions } from "@/lib/catalog-context";
import { getDb } from "@/lib/db";
import { formatPrice } from "@/lib/format";
import { getCategoryTree } from "@/modules/catalog/pages";
import {
  MIN_QUERY_LENGTH,
  PostgresSearchService,
  type SearchProductHit,
} from "@/modules/search/service";

type Props = { searchParams: Promise<{ q?: string | string[]; page?: string | string[] }> };

// Search result pages are never indexed (SPEC §7.8).
export const metadata: Metadata = { title: "Search", robots: { index: false, follow: true } };

function first(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function ResultRow({
  hit,
  query,
  market,
}: {
  hit: SearchProductHit;
  query: string;
  market: string;
}) {
  return (
    <li className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 border-b py-4 sm:grid-cols-[96px_minmax(0,1fr)_auto]">
      <ImagePlaceholder
        icon={hit.category.icon}
        label="No image"
        className="aspect-square border"
        iconClassName="size-6"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] font-medium tracking-[0.1em] text-primary uppercase">
          {hit.brand.name} · {hit.category.name}
        </span>
        <h3 className="text-xl leading-tight">
          <Link href={hit.href} className="hover:text-primary">
            <Highlighted text={`${hit.brand.name} ${hit.name}`} query={query} />
          </Link>
        </h3>
        {hit.modelNumber ? (
          <span className="model-number text-[13px] text-muted-foreground">
            <Highlighted text={hit.modelNumber} query={query} />
            {hit.matchedVariantCode ? ` · variant ${hit.matchedVariantCode}` : ""}
          </span>
        ) : null}
        {hit.keySpecs.length ? (
          <span className="text-xs text-muted-foreground">
            {hit.keySpecs.map((s) => s.value).join(" · ")}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-3">
          <VerificationBadge verifiedAt={hit.lastVerifiedAt} />
          {hit.isDemo ? <DemoTag /> : null}
        </span>
      </div>
      <div className="col-span-2 text-sm sm:col-span-1 sm:text-right">
        {market !== "ALL" && hit.offer?.price && hit.offer.currency ? (
          <span className="flex flex-col">
            <span className="text-xs text-muted-foreground">From</span>
            <span className="font-heading text-xl font-semibold">
              {formatPrice(hit.offer.price, hit.offer.currency)}
            </span>
          </span>
        ) : null}
      </div>
    </li>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  const raw = await searchParams;
  const q = first(raw.q).trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(first(raw.page) || "1", 10) || 1);
  const db = getDb();
  const opts = await getCatalogOptions();
  const tooShort = q.length > 0 && q.length < MIN_QUERY_LENGTH;
  const results =
    q.length >= MIN_QUERY_LENGTH
      ? await new PostgresSearchService(db).search(q, { ...opts, page })
      : null;
  const exact = results?.products.filter((p) => p.exact) ?? [];
  const rest = results?.products.filter((p) => !p.exact) ?? [];
  const empty =
    results &&
    results.total === 0 &&
    results.brands.length === 0 &&
    results.categories.length === 0;
  const categories = empty || !q ? await getCategoryTree(db) : [];

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Search" }]} />
        <h1 className="text-5xl">{q ? <>Results for &ldquo;{q}&rdquo;</> : "Search"}</h1>
        <SearchBox variant="page" defaultValue={q} autoFocus={!q} className="max-w-[700px]" />
        {tooShort ? (
          <p className="text-sm text-muted-foreground">
            Type at least {MIN_QUERY_LENGTH} characters.
          </p>
        ) : null}
      </div>

      {results && exact.length ? (
        <section aria-labelledby="exact-title">
          <Blueprint className="flex flex-col gap-2 p-5">
            <h2 id="exact-title" className="label-caps text-primary">
              Exact model number match
            </h2>
            <ul>
              {exact.map((hit) => (
                <ResultRow key={hit.id} hit={hit} query={q} market={opts.market} />
              ))}
            </ul>
          </Blueprint>
        </section>
      ) : null}

      {results && (results.brands.length || results.categories.length) ? (
        <div className="grid gap-6 md:grid-cols-2">
          {results.brands.length ? (
            <section aria-labelledby="brand-hits" className="flex flex-col gap-2">
              <h2 id="brand-hits" className="label-caps">
                Brands
              </h2>
              <ul className="flex flex-wrap gap-2">
                {results.brands.map((b) => (
                  <li key={b.slug}>
                    <Link
                      href={`/brands/${b.slug}`}
                      className="flex min-h-11 items-center gap-2 border px-3 text-sm hover:bg-accent sm:min-h-9"
                    >
                      <Highlighted text={b.name} query={q} />
                      <span className="text-xs text-muted-foreground">{b.productCount}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {results.categories.length ? (
            <section aria-labelledby="category-hits" className="flex flex-col gap-2">
              <h2 id="category-hits" className="label-caps">
                Categories
              </h2>
              <ul className="flex flex-wrap gap-2">
                {results.categories.map((c) => (
                  <li key={c.slug}>
                    <Link
                      href={`/categories/${c.slug}`}
                      className="flex min-h-11 items-center border px-3 text-sm hover:bg-accent sm:min-h-9"
                    >
                      <Highlighted
                        text={c.parentName ? `${c.parentName} › ${c.name}` : c.name}
                        query={q}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {results && rest.length ? (
        <section aria-labelledby="product-hits" className="flex flex-col gap-2">
          <h2
            id="product-hits"
            className="flex items-baseline justify-between border-b border-border-strong pb-2.5 text-[28px]"
          >
            Products
            <span className="text-sm font-normal text-muted-foreground" role="status">
              {results.total} {results.total === 1 ? "result" : "results"}
            </span>
          </h2>
          <ul>
            {rest.map((hit) => (
              <ResultRow key={hit.id} hit={hit} query={q} market={opts.market} />
            ))}
          </ul>
        </section>
      ) : null}

      {results ? (
        <Pagination
          page={results.page}
          pageCount={results.pageCount}
          hrefFor={(p) => `/search?q=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ""}`}
        />
      ) : null}

      {empty ? (
        <section aria-labelledby="no-results" className="blueprint flex flex-col gap-4 p-6">
          <h2 id="no-results" className="text-2xl">
            Nothing matched &ldquo;{q}&rdquo;
          </h2>
          {results?.didYouMean.length ? (
            <p className="text-sm">
              Did you mean{" "}
              {results.didYouMean.map((term, i) => (
                <span key={term}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/search?q=${encodeURIComponent(term)}`} className="text-primary">
                    {term}
                  </Link>
                </span>
              ))}
              ?
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Check the spelling, try fewer words, or search by model number (for example the code
            printed on the box).
          </p>
        </section>
      ) : null}

      {categories.length ? (
        <section aria-labelledby="browse" className="flex flex-col gap-3">
          <h2 id="browse" className="label-caps">
            Browse by category
          </h2>
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/categories/${c.slug}`}
                  className="flex min-h-11 items-center border px-3 text-sm hover:bg-accent sm:min-h-9"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}
