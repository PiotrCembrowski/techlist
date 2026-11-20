"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CategoryIcon } from "@/components/product/image-placeholder";
import { compareTray, TRAY_MAX, useCompareTray } from "@/lib/compare-tray";
import { comparisonPath } from "@/modules/comparisons/url";

/**
 * Floating comparison tray (max 4, with thumbnails). Hidden on comparison pages, which show the
 * same products as columns. Also hosts the "different category" and "tray full" notices.
 */
export function CompareTray() {
  const { items, pending, full } = useCompareTray();
  const pathname = usePathname();
  if (pathname.startsWith("/compare")) return null;
  if (items.length === 0 && !pending) return null;

  const ready = items.length >= 2;
  return (
    <>
      {/* Reserves room at the end of the page so the fixed tray never covers the footer. */}
      <div aria-hidden="true" className="h-36 sm:h-24" />
      <aside
        aria-label="Comparison tray"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background shadow-[0_-3px_10px_rgba(43,43,45,0.16)] data-[shown]:animate-in data-[shown]:slide-in-from-bottom"
        data-shown=""
      >
        <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-3 sm:px-6 lg:px-10">
          {pending ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 border border-warning/40 px-3 py-2 text-sm"
            >
              <span className="flex-1">
                Your comparison has {items[0]?.topCategoryName}. Products can only be compared
                within one category.
              </span>
              <button
                type="button"
                onClick={() => compareTray.acceptPending()}
                className="min-h-11 border px-3 font-medium hover:bg-accent sm:min-h-8"
              >
                Start new comparison with {pending.name}
              </button>
              <button
                type="button"
                onClick={() => compareTray.dismiss()}
                className="min-h-11 px-2 text-primary sm:min-h-8"
              >
                Keep current
              </button>
            </div>
          ) : null}
          {full ? (
            <div role="alert" className="flex items-center gap-3 text-sm">
              <span className="flex-1">
                You can compare up to {TRAY_MAX} products. Remove one to add another.
              </span>
              <button type="button" onClick={() => compareTray.dismiss()} className="text-primary">
                OK
              </button>
            </div>
          ) : null}
          {items.length ? (
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="font-heading text-sm font-semibold tracking-[0.08em] uppercase"
                aria-live="polite"
              >
                Compare {items.length}/{TRAY_MAX}
              </span>
              <ul className="flex flex-1 flex-wrap gap-2">
                {items.map((i) => (
                  <li
                    key={i.slug}
                    className="flex items-center gap-2 border py-1 pr-1 pl-1.5 text-sm"
                  >
                    <span
                      className="image-placeholder flex size-8 items-center justify-center border text-muted-foreground"
                      aria-hidden="true"
                    >
                      <CategoryIcon name={i.icon} className="size-4" />
                    </span>
                    <span className="max-w-[160px] truncate">{i.name}</span>
                    <button
                      type="button"
                      onClick={() => compareTray.remove(i.slug)}
                      aria-label={`Remove ${i.brandName} ${i.name} from comparison`}
                      className="flex size-11 items-center justify-center hover:bg-accent sm:size-7"
                    >
                      <X strokeWidth={1.5} className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => compareTray.clear()}
                className="min-h-11 text-sm text-primary sm:min-h-0"
              >
                Clear
              </button>
              {ready ? (
                <Link
                  href={comparisonPath(items.map((i) => i.slug))}
                  className="blueprint flex h-11 items-center border-primary bg-primary px-5 font-heading font-semibold text-primary-foreground hover:bg-primary-hover sm:h-9"
                >
                  Compare {items.length} products
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Add one more {items[0]?.topCategoryName.toLowerCase()} product to compare
                </span>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

/** Header link with the tray count (SPEC §7.2). */
export function HeaderCompareLink({ className }: { className?: string }) {
  const { items } = useCompareTray();
  return (
    <Link
      href={items.length >= 2 ? comparisonPath(items.map((i) => i.slug)) : "/compare"}
      className={className}
    >
      Compare
      <span
        className="ml-1 inline-flex min-w-5 items-center justify-center border px-1 text-[11px] tabular-nums"
        aria-label={`${items.length} products in comparison`}
      >
        {items.length}
      </span>
    </Link>
  );
}
