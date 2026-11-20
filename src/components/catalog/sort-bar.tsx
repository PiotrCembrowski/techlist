import Link from "next/link";
import {
  catalogQueryString,
  type CatalogFilters,
  type CatalogSort,
} from "@/modules/catalog/filters";
import { cn } from "@/lib/utils";

const LABELS: Record<CatalogSort, string> = {
  newest: "Newest",
  name: "Name",
  release_date: "Release date",
  price_asc: "Lowest price",
};

/** Sort as links (works without JavaScript). "Lowest price" only exists when a single-currency market is selected. */
export function SortBar({
  path,
  filters,
  priceAvailable,
  withExtra = (qs) => qs,
}: {
  path: string;
  filters: CatalogFilters;
  priceAvailable: boolean;
  withExtra?: (qs: string) => string;
}) {
  const sorts = (Object.keys(LABELS) as CatalogSort[]).filter(
    (s) => s !== "price_asc" || priceAvailable,
  );
  return (
    <nav aria-label="Sort" className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Sort</span>
      <span className="inline-flex flex-wrap border">
        {sorts.map((s, i) => {
          const active =
            filters.sort === s ||
            (s === "newest" && filters.sort === "price_asc" && !priceAvailable);
          return (
            <Link
              key={s}
              href={`${path}${withExtra(catalogQueryString({ ...filters, sort: s, page: 1 }))}`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex min-h-11 items-center px-3 py-1.5 sm:min-h-0",
                i > 0 && "border-l",
                active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {LABELS[s]}
            </Link>
          );
        })}
      </span>
    </nav>
  );
}
