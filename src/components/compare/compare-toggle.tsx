"use client";

import { Check, GitCompareArrows } from "lucide-react";
import { compareTray, TRAY_MAX, useCompareTray, type TrayItem } from "@/lib/compare-tray";
import { cn } from "@/lib/utils";

/**
 * Adds/removes a product from the comparison tray. On cards it sits above the card's stretched
 * link (relative z-10) so it is independently clickable and focusable.
 */
export function CompareToggle({
  item,
  variant = "card",
}: {
  item: TrayItem;
  variant?: "card" | "button";
}) {
  const { items } = useCompareTray();
  const selected = items.some((i) => i.slug === item.slug);
  const full =
    !selected && items.length >= TRAY_MAX && items[0]?.topCategorySlug === item.topCategorySlug;
  const label = selected ? "In comparison" : "Compare";

  const onClick = () => {
    if (selected) compareTray.remove(item.slug);
    else compareTray.add(item);
  };

  if (variant === "button") {
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={cn(
          "inline-flex h-11 items-center gap-2 border px-[18px] font-heading text-[15px] font-semibold",
          selected
            ? "border-primary bg-primary text-primary-foreground hover:bg-primary-hover"
            : "hover:bg-accent",
        )}
      >
        {selected ? (
          <Check aria-hidden="true" strokeWidth={2} className="size-4" />
        ) : (
          <GitCompareArrows aria-hidden="true" strokeWidth={1.5} className="size-4" />
        )}
        {selected ? "In comparison" : "Add to compare"}
        {full ? <span className="sr-only">(comparison is full)</span> : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${label}: ${item.brandName} ${item.name}`}
      onClick={onClick}
      className="relative z-10 flex min-h-11 shrink-0 items-center gap-2 text-[13px] font-medium hover:text-primary sm:min-h-8"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 items-center justify-center border-[1.5px]",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-foreground/50",
        )}
      >
        {selected ? <Check strokeWidth={3} className="size-3" /> : null}
      </span>
      {label}
    </button>
  );
}
