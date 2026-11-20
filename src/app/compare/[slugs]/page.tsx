import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { ComparePicker, DifferencesToggle, TraySync } from "@/components/compare/compare-client";
import { RemoveFromComparison } from "@/components/compare/remove-link";
import { DemoTag } from "@/components/product/demo-tag";
import { CategoryIcon } from "@/components/product/image-placeholder";
import { NotAvailable } from "@/components/product/spec-table";
import { VerificationBadge } from "@/components/product/verification-badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { formatPrice, marketName } from "@/lib/format";
import { getSelectedMarket } from "@/lib/market/server";
import { cn } from "@/lib/utils";
import type { CompareCell, CompareRow } from "@/modules/comparisons/rows";
import { compareProducts, type ComparedProduct } from "@/modules/comparisons/service";
import { comparisonPath, MAX_COMPARE, parseComparisonParam } from "@/modules/comparisons/url";

type Props = { params: Promise<{ slugs: string }> };

const load = cache(async (param: string) => {
  const parsed = parseComparisonParam(param);
  if (!parsed.ok) return { parsed, result: null };
  const market = await getSelectedMarket();
  const result = await compareProducts(getDb(), parsed.canonical, {
    market,
    staleHours: getEnv().OFFER_STALE_HOURS,
  });
  return { parsed, result, market };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { result } = await load((await params).slugs);
  if (!result || (result.kind !== "ok" && result.kind !== "mixed_categories")) return {};
  const title = result.products.map((p) => `${p.brand.name} ${p.name}`).join(" vs ");
  return {
    title,
    description: `${title}: specifications side by side, with differences highlighted.`,
    alternates: { canonical: comparisonPath(result.products.map((p) => p.slug)) },
    ...(result.kind === "mixed_categories" || result.products.some((p) => p.isDemo)
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

function BetterMark({ row }: { row: CompareRow }) {
  if (row.direction === "higher_is_better") {
    return (
      <span className="inline-flex items-center gap-0.5 border border-primary/40 px-1 text-[11px] text-primary">
        <ArrowUp aria-hidden="true" strokeWidth={1.5} className="size-3" />
        Highest<span className="sr-only"> (higher is better)</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 border border-primary/40 px-1 text-[11px] text-primary">
      <ArrowDown aria-hidden="true" strokeWidth={1.5} className="size-3" />
      Lowest<span className="sr-only"> (lower is better)</span>
    </span>
  );
}

function Cell({ cell, row }: { cell: CompareCell; row: CompareRow }) {
  return (
    <td
      className={cn(
        "border-r border-b px-4 py-2.5 align-top",
        !row.differs && "text-muted-foreground",
      )}
    >
      {cell.display === null ? (
        <NotAvailable />
      ) : (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn(row.differs && "font-medium text-foreground")}>{cell.display}</span>
          {cell.better ? <BetterMark row={row} /> : null}
          {cell.manufacturerClaim ? (
            <span
              className="text-[11px] text-muted-foreground"
              title="Value as stated by the manufacturer, not independently measured"
            >
              manufacturer claim
            </span>
          ) : null}
        </span>
      )}
    </td>
  );
}

function OfferCell({ p, market }: { p: ComparedProduct; market: string }) {
  const o = p.offer;
  let content: React.ReactNode;
  if (!o)
    content = (
      <span className="text-muted-foreground">
        No current offers{market !== "ALL" ? ` in ${marketName(market)}` : ""}
      </span>
    );
  else if (market === "ALL")
    content = (
      <span>
        {o.offerCount} current {o.offerCount === 1 ? "offer" : "offers"} in {o.marketCount}{" "}
        {o.marketCount === 1 ? "market" : "markets"}
        <span className="block text-xs text-muted-foreground">Choose a market to see prices</span>
      </span>
    );
  else if (!o.price || !o.currency)
    content = <span className="text-muted-foreground">None in stock in {marketName(market)}</span>;
  else
    content = (
      <span className="flex flex-col">
        <span className="font-heading text-xl font-semibold">
          {formatPrice(o.price, o.currency)}
        </span>
        <span className="text-xs text-muted-foreground">
          lowest of {o.offerCount} in {market}
        </span>
      </span>
    );
  return <td className="border-r border-b px-4 py-3 align-top">{content}</td>;
}

export default async function ComparisonPage({ params }: Props) {
  const raw = (await params).slugs;
  const { parsed, result, market } = await load(raw);
  if (!parsed.ok || !result) notFound();
  if (!parsed.isCanonical) permanentRedirect(comparisonPath(parsed.canonical));
  if (result.kind === "not_found") notFound();
  if (result.kind === "redirect") permanentRedirect(result.to);

  const crumbs = [
    { label: "Home", href: "/" },
    { label: "Compare", href: "/compare" },
  ];

  if (result.kind === "mixed_categories") {
    const groups = new Map<string, ComparedProduct[]>();
    for (const p of result.products)
      groups.set(p.topCategory.name, [...(groups.get(p.topCategory.name) ?? []), p]);
    return (
      <Container className="flex flex-col gap-6 py-10">
        <Breadcrumbs items={[...crumbs, { label: "Different categories" }]} />
        <h1 className="text-5xl">These products can&rsquo;t be compared</h1>
        <p className="max-w-[68ch] text-muted-foreground">
          Comparisons only make sense within one category, where every product has the same
          specifications. Choose a group below.
        </p>
        <ul className="grid gap-6 md:grid-cols-2">
          {[...groups].map(([name, items]) => (
            <li key={name} className="blueprint flex flex-col gap-3 p-5">
              <h2 className="text-2xl">{name}</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {items.map((p) => (
                  <li key={p.slug}>
                    <Link href={p.href} className="text-primary">
                      {p.brand.name} {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
              {items.length >= 2 ? (
                <Link
                  href={comparisonPath(items.map((p) => p.slug))}
                  className="w-fit border px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  Compare these {items.length}
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Add another {name.toLowerCase()} product to compare.
                </span>
              )}
            </li>
          ))}
        </ul>
      </Container>
    );
  }

  const { products, groups, category } = result;
  const slugs = products.map((p) => p.slug);
  const trayItems = products.map((p) => ({
    slug: p.slug,
    name: p.name,
    brandName: p.brand.name,
    href: p.href,
    topCategorySlug: p.topCategory.slug,
    topCategoryName: p.topCategory.name,
    icon: p.category.icon,
  }));
  const canAdd = products.length < MAX_COMPARE;
  const differing = groups.reduce((n, g) => n + g.rows.filter((r) => r.differs).length, 0);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const cols = products.length + (canAdd ? 1 : 0);

  return (
    <Container className="flex flex-col gap-6 py-10">
      <TraySync items={trayItems} />
      <Breadcrumbs
        items={[
          ...crumbs,
          { label: category.name, href: `/categories/${category.slug}` },
          { label: "Comparison" },
        ]}
      />
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium tracking-[0.12em] text-primary uppercase">
          {category.name} · comparison
        </span>
        <h1 className="text-4xl leading-tight sm:text-5xl">
          {products.map((p) => p.name).join(" vs ")}
        </h1>
        <p className="text-sm text-muted-foreground" role="status">
          {differing} of {total} specifications differ. Values are in the same units for every
          product. There is no overall winner: markers only show which value is higher or lower
          where that is meaningful.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y py-2">
        <DifferencesToggle targetId="comparison" />
        {market !== "ALL" ? (
          <span className="text-sm text-muted-foreground">
            Prices for {marketName(market)}, in each retailer&rsquo;s currency
          </span>
        ) : null}
      </div>

      <div
        id="comparison"
        className="group/cmp max-h-[80vh] overflow-auto border"
        tabIndex={0}
        aria-label="Comparison table, scrollable"
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Specifications of {products.map((p) => `${p.brand.name} ${p.name}`).join(", ")}
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-30 w-[132px] border-r border-b bg-background p-3 text-left align-bottom sm:w-[220px]"
              >
                <span className="label-caps">Specification</span>
              </th>
              {products.map((p) => (
                <th
                  key={p.slug}
                  scope="col"
                  className="sticky top-0 z-20 w-[200px] min-w-[200px] border-r border-b bg-background p-3 text-left align-top font-normal sm:w-[240px]"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="image-placeholder flex size-10 shrink-0 items-center justify-center border text-muted-foreground"
                      aria-hidden="true"
                    >
                      <CategoryIcon name={p.category.icon} className="size-5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[11px] font-medium tracking-[0.1em] text-primary uppercase">
                        {p.brand.name}
                      </span>
                      <Link
                        href={p.href}
                        className="font-heading text-lg leading-tight font-semibold hover:text-primary"
                      >
                        {p.name}
                      </Link>
                      {p.modelNumber ? (
                        <span className="model-number text-xs text-muted-foreground">
                          {p.modelNumber}
                        </span>
                      ) : null}
                    </span>
                    <RemoveFromComparison
                      slug={p.slug}
                      label={`${p.brand.name} ${p.name}`}
                      href={comparisonPath(slugs.filter((s) => s !== p.slug))}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <VerificationBadge
                      status={p.verificationStatus}
                      verifiedAt={p.lastVerifiedAt}
                    />
                    {p.isDemo ? <DemoTag /> : null}
                  </div>
                </th>
              ))}
              {canAdd ? (
                <th
                  scope="col"
                  className="sticky top-0 z-20 w-[180px] min-w-[180px] border-b bg-background p-3 text-left align-middle font-normal"
                >
                  <a
                    href="#add-product"
                    className="flex min-h-11 items-center justify-center gap-1.5 border border-dashed text-sm font-medium text-primary hover:bg-accent"
                  >
                    <Plus aria-hidden="true" strokeWidth={1.5} className="size-4" />
                    Add product
                  </a>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 border-r border-b bg-background px-3 py-3 text-left align-top font-medium"
              >
                Best current offer
              </th>
              {products.map((p) => (
                <OfferCell key={p.slug} p={p} market={market} />
              ))}
              {canAdd ? <td className="border-b" /> : null}
            </tr>
          </tbody>
          {groups.map((g) => (
            <tbody key={g.key}>
              <tr
                className={cn(
                  g.rows.every((r) => !r.differs) && "group-data-[only-differences]/cmp:hidden",
                )}
              >
                <th
                  scope="colgroup"
                  colSpan={cols + 1}
                  className="border-b border-border-strong bg-muted/40 px-3 pt-4 pb-1.5 text-left"
                >
                  <span className="sticky left-3 font-heading text-lg font-semibold">{g.name}</span>
                </th>
              </tr>
              {g.rows.map((row) => (
                <tr
                  key={row.key}
                  data-differs={row.differs}
                  className={cn(!row.differs && "group-data-[only-differences]/cmp:hidden")}
                >
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 border-r border-b bg-background px-3 py-2.5 text-left align-top",
                      row.differs
                        ? "border-l-2 border-l-primary font-medium text-foreground"
                        : "font-normal text-muted-foreground",
                    )}
                  >
                    {row.label}
                    {row.differs ? <span className="sr-only"> (differs)</span> : null}
                  </th>
                  {row.cells.map((cell, i) => (
                    <Cell key={i} cell={cell} row={row} />
                  ))}
                  {canAdd ? <td className="border-b" /> : null}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {canAdd ? (
        <section
          id="add-product"
          aria-labelledby="add-title"
          className="blueprint flex flex-col gap-3 p-5 lg:max-w-[640px]"
        >
          <h2 id="add-title" className="text-2xl">
            Add a product
          </h2>
          <ComparePicker
            category={{ slug: products[0]!.topCategory.slug, name: products[0]!.topCategory.name }}
            current={slugs}
            mode="navigate"
          />
        </section>
      ) : null}
    </Container>
  );
}
