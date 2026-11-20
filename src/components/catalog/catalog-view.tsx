import Link from "next/link";
import { ProductGrid } from "@/components/product/product-card";
import { marketName } from "@/lib/format";
import { catalogQueryString, isFiltered, type CatalogFilters } from "@/modules/catalog/filters";

export { hasEmptyParams } from "@/modules/catalog/filters";
import type { ProductCardData } from "@/modules/catalog/service";
import { FilterForm, type FilterFormProps } from "./filter-form";
import { Pagination } from "./pagination";
import { SortBar } from "./sort-bar";

export function CatalogView({
  path,
  filters,
  result,
  market,
  filterProps,
  extraQuery = {},
}: {
  path: string;
  filters: CatalogFilters;
  result: { items: ProductCardData[]; total: number; page: number; pageCount: number };
  market: string;
  filterProps: Omit<FilterFormProps, "path" | "filters">;
  /** Non-filter params that must survive pagination/sort (e.g. category on /products). */
  extraQuery?: Record<string, string>;
}) {
  const extra = new URLSearchParams(extraQuery).toString();
  const withExtra = (qs: string) => (extra ? (qs ? `${qs}&${extra}` : `?${extra}`) : qs);
  const filtered = isFiltered(filters) || Object.keys(extraQuery).length > 0;
  return (
    <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside aria-label="Filters">
        <FilterForm path={path} filters={filters} {...filterProps} />
      </aside>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <p className="text-sm text-muted-foreground" role="status">
            <span className="font-medium text-foreground">{result.total}</span>{" "}
            {result.total === 1 ? "product" : "products"}
            {market !== "ALL" ? <> · offers for {marketName(market)}</> : null}
          </p>
          <SortBar
            path={path}
            filters={filters}
            priceAvailable={Boolean(filterProps.priceCurrency)}
            withExtra={withExtra}
          />
        </div>
        {result.items.length ? (
          <ProductGrid cards={result.items} market={market} />
        ) : (
          <div className="blueprint flex flex-col items-start gap-3 p-8">
            <h2 className="text-2xl">No products match these filters</h2>
            <p className="text-sm text-muted-foreground">
              Try removing a filter or widening a range. Products only appear when they have a value
              for the specification you filter on.
            </p>
            {filtered ? (
              <Link href={path} className="text-sm text-primary">
                Clear all filters
              </Link>
            ) : null}
          </div>
        )}
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          hrefFor={(p) => `${path}${withExtra(catalogQueryString({ ...filters, page: p }))}`}
        />
      </div>
    </div>
  );
}
