"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { compareTray } from "@/lib/compare-tray";

/** Removes a product from the comparison: updates the tray and navigates to the new canonical URL. */
export function RemoveFromComparison({
  slug,
  label,
  href,
}: {
  slug: string;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      onClick={() => compareTray.remove(slug)}
      aria-label={`Remove ${label} from comparison`}
      className="flex size-11 shrink-0 items-center justify-center border hover:bg-accent sm:size-8"
    >
      <X aria-hidden="true" strokeWidth={1.5} className="size-4" />
    </Link>
  );
}
