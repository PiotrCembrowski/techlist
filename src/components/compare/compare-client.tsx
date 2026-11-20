"use client";

import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { CategoryIcon } from "@/components/product/image-placeholder";
import { compareTray, useCompareTray, type TrayItem } from "@/lib/compare-tray";
import { comparisonPath, MAX_COMPARE } from "@/modules/comparisons/url";

/** Viewing a comparison (e.g. a shared link) makes those products the current tray. */
export function TraySync({ items }: { items: TrayItem[] }) {
  const key = items.map((i) => i.slug).join("|");
  useEffect(() => {
    compareTray.replace(items);
    // `key` captures the identity of `items`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/** "Show only differences": hides rows whose values are identical (CSS only, nothing refetched). */
export function DifferencesToggle({ targetId }: { targetId: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    document.getElementById(targetId)?.toggleAttribute("data-only-differences", on);
  }, [on, targetId]);
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium sm:min-h-0">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
        className="size-4 accent-[var(--primary)]"
      />
      Show only differences
    </label>
  );
}

interface Candidate extends TrayItem {
  modelNumber: string | null;
}

/**
 * Search-as-you-type product picker. On a comparison page it navigates to the new canonical URL;
 * on /compare it fills the tray. Results are limited to one top-level category when given.
 */
export function ComparePicker({
  category,
  current,
  mode,
}: {
  category: { slug: string; name: string } | null;
  current: string[];
  mode: "navigate" | "tray";
}) {
  const router = useRouter();
  const tray = useCompareTray();
  const uid = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const exclude = mode === "tray" ? tray.items.map((i) => i.slug) : current;
  const scope =
    category ??
    (tray.items[0]
      ? { slug: tray.items[0].topCategorySlug, name: tray.items[0].topCategoryName }
      : null);
  // Depend on the slug, not the object (a new object every render would refetch in a loop).
  const scopeSlug = scope?.slug ?? null;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term });
        if (scopeSlug) params.set("category", scopeSlug);
        const res = await fetch(`/api/compare/search?${params}`, { signal: ctrl.signal });
        if (res.ok) setResults(((await res.json()) as { items: Candidate[] }).items);
      } catch {
        /* aborted */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, scopeSlug]);

  const shown =
    q.trim().length >= 2 ? (results ?? []).filter((r) => !exclude.includes(r.slug)) : [];
  const full = exclude.length >= MAX_COMPARE;

  const add = (c: Candidate) => {
    const { modelNumber: _modelNumber, ...item } = c;
    void _modelNumber;
    if (mode === "navigate") {
      router.push(comparisonPath([...current, c.slug])); // TraySync on the new page updates the tray
    } else {
      compareTray.add(item);
    }
    setQ("");
    setResults(null);
  };

  if (full)
    return (
      <p className="text-sm text-muted-foreground">
        Comparisons hold up to {MAX_COMPARE} products. Remove one to add another.
      </p>
    );

  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={`${uid}-q`} className="label-caps">
        {scope ? `Add a ${scope.name.toLowerCase()} product` : "Find a product to compare"}
      </label>
      <div className="flex h-11 items-center gap-2 border bg-background px-3 focus-within:border-ring sm:h-10">
        <Search aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0" />
        <input
          id={`${uid}-q`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or model number"
          autoComplete="off"
          maxLength={100}
          aria-describedby={`${uid}-status`}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:outline-none"
        />
      </div>
      <p id={`${uid}-status`} className="sr-only" aria-live="polite">
        {q.trim().length >= 2 && results ? `${shown.length} products found` : ""}
      </p>
      {shown.length ? (
        <ul className="flex flex-col border" aria-label="Matching products">
          {shown.map((c) => (
            <li key={c.slug} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
              <span
                className="image-placeholder flex size-9 shrink-0 items-center justify-center border text-muted-foreground"
                aria-hidden="true"
              >
                <CategoryIcon name={c.icon} className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {c.brandName} {c.name}
                </span>
                {c.modelNumber ? (
                  <span className="model-number truncate text-xs text-muted-foreground">
                    {c.modelNumber}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => add(c)}
                aria-label={`Add ${c.brandName} ${c.name} to comparison`}
                className="flex min-h-11 items-center gap-1 border px-3 text-sm font-medium hover:bg-accent sm:min-h-8"
              >
                <Plus aria-hidden="true" strokeWidth={1.5} className="size-3.5" />
                Add
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 2 && results ? (
        <p className="text-sm text-muted-foreground">
          No {scope ? scope.name.toLowerCase() + " " : ""}products match.
        </p>
      ) : null}
    </div>
  );
}

/** /compare: shows the tray as the current comparison and jumps to it once two are chosen. */
export function CompareHome() {
  const { items } = useCompareTray();
  const router = useRouter();
  const ready = items.length >= 2;
  const path = comparisonPath(items.map((i) => i.slug));
  useEffect(() => {
    if (ready) router.replace(path);
  }, [ready, path, router]);

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <ComparePicker category={null} current={[]} mode="tray" />
      </div>
      <div className="flex flex-col gap-3 lg:col-span-5">
        <span className="label-caps">Selected</span>
        {items.length ? (
          <ul className="flex flex-col border">
            {items.map((i) => (
              <li
                key={i.slug}
                className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
              >
                <span className="text-sm font-medium">
                  {i.brandName} {i.name}
                </span>
                <button
                  type="button"
                  onClick={() => compareTray.remove(i.slug)}
                  className="min-h-11 text-sm text-primary sm:min-h-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing selected yet. Search here, or use &ldquo;Compare&rdquo; on any product card or
            product page.
          </p>
        )}
        {items.length === 1 ? (
          <p className="text-sm text-muted-foreground">
            Add one more product to see the comparison.
          </p>
        ) : null}
      </div>
    </div>
  );
}
