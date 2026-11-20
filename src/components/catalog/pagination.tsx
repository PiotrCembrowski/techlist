import Link from "next/link";
import { cn } from "@/lib/utils";

/** Crawlable pagination: plain links with ?page=N, current page marked with aria-current. */
export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const pages = new Set(
    [1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount),
  );
  const list = [...pages].sort((a, b) => a - b);
  const cell =
    "flex h-11 min-w-11 items-center justify-center border px-3 text-sm sm:h-9 sm:min-w-9";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-1.5">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={cn(cell, "hover:bg-accent")}>
          Previous
        </Link>
      ) : null}
      {list.map((p, i) => (
        <span key={p} className="flex items-center gap-1.5">
          {i > 0 && p - list[i - 1]! > 1 ? <span aria-hidden="true">…</span> : null}
          {p === page ? (
            <span
              aria-current="page"
              className={cn(cell, "border-primary bg-primary font-medium text-primary-foreground")}
            >
              {p}
            </span>
          ) : (
            <Link
              href={hrefFor(p)}
              className={cn(cell, "hover:bg-accent")}
              aria-label={`Page ${p}`}
            >
              {p}
            </Link>
          )}
        </span>
      ))}
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} rel="next" className={cn(cell, "hover:bg-accent")}>
          Next
        </Link>
      ) : null}
    </nav>
  );
}
