"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CategoryIcon } from "@/components/product/image-placeholder";
import { cn } from "@/lib/utils";
import type { Suggestion } from "@/modules/search/service";

const DEBOUNCE_MS = 200;
const MIN_LENGTH = 2;

type Option = {
  id: string;
  href: string;
  group: "products" | "brands" | "categories";
  label: string;
  meta?: string;
  icon?: string | null;
  exact?: boolean;
};

/**
 * Search with suggestions (ARIA 1.2 combobox + listbox). Without JavaScript it is a plain GET
 * form to /search. Suggestions are debounced, aborted when superseded, and capped server-side.
 */
export function SearchBox({
  variant = "header",
  defaultValue = "",
  autoFocus = false,
  className,
}: {
  variant?: "header" | "hero" | "page";
  defaultValue?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState(defaultValue);
  const [data, setData] = useState<Suggestion | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    // Short queries: nothing to fetch; the list is hidden by `expanded` below.
    if (term.length < MIN_LENGTH) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        if (res.ok) {
          setData((await res.json()) as Suggestion);
          setActive(-1);
        }
      } catch {
        /* aborted or offline: keep the plain form working */
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const options = useMemo<Option[]>(() => {
    if (!data) return [];
    return [
      ...data.products.map((p, i) => ({
        id: `${uid}-p${i}`,
        href: p.href,
        group: "products" as const,
        label: `${p.brandName} ${p.name}`,
        meta: [p.modelNumber, p.categoryName].filter(Boolean).join(" · "),
        icon: p.categoryIcon,
        exact: p.exact,
      })),
      ...data.brands.map((b, i) => ({
        id: `${uid}-b${i}`,
        href: b.href,
        group: "brands" as const,
        label: b.name,
      })),
      ...data.categories.map((c, i) => ({
        id: `${uid}-c${i}`,
        href: c.href,
        group: "categories" as const,
        label: c.name,
      })),
    ];
  }, [data, uid]);

  const expanded = open && q.trim().length >= MIN_LENGTH && data !== null;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (options.length ? (a + 1) % options.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (options.length ? (a <= 0 ? options.length - 1 : a - 1) : -1));
    } else if (e.key === "Enter" && expanded && active >= 0 && options[active]) {
      e.preventDefault();
      go(options[active].href);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const groups: { key: Option["group"]; label: string }[] = [
    { key: "products", label: "Products" },
    { key: "brands", label: "Brands" },
    { key: "categories", label: "Categories" },
  ];
  const big = variant === "hero";

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <form action="/search" method="get" role="search" className="flex">
        <div
          className={cn(
            "flex flex-1 items-center gap-3 border bg-background focus-within:border-ring",
            big ? "h-14 border-border-strong px-[18px]" : "h-10 px-3",
          )}
        >
          <Search
            aria-hidden="true"
            strokeWidth={1.5}
            className={big ? "size-5 shrink-0" : "size-4 shrink-0"}
          />
          <label htmlFor={`${uid}-input`} className="sr-only">
            Search products, brands or model numbers
          </label>
          <input
            id={`${uid}-input`}
            name="q"
            type="search"
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={expanded && active >= 0 ? options[active]?.id : undefined}
            autoComplete="off"
            autoFocus={autoFocus}
            maxLength={100}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search products, brands or model numbers"
            className={cn(
              "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus-visible:outline-none",
              big ? "text-base" : "text-sm",
            )}
          />
        </div>
        {variant !== "header" ? (
          <button
            type="submit"
            className={cn(
              "blueprint border-primary bg-primary font-heading font-semibold text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
              big ? "h-14 px-7 text-base" : "h-10 px-4 text-sm",
            )}
          >
            Search
          </button>
        ) : (
          <button type="submit" className="sr-only">
            Search
          </button>
        )}
      </form>

      <div
        id={listId}
        role="listbox"
        aria-label="Search suggestions"
        hidden={!expanded}
        className="absolute top-full right-0 left-0 z-40 mt-1 max-h-[70vh] overflow-y-auto border bg-popover shadow-[0_12px_32px_rgba(43,43,45,0.22)]"
      >
        {expanded && options.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            No suggestions. Press Enter to search all results.
          </p>
        ) : null}
        {groups.map((g) => {
          const items = options.filter((o) => o.group === g.key);
          if (!items.length) return null;
          return (
            <div key={g.key} role="group" aria-label={g.label} className="border-b last:border-b-0">
              <div className="label-caps px-3 pt-2.5 pb-1" aria-hidden="true">
                {g.label}
              </div>
              {items.map((o) => {
                const idx = options.indexOf(o);
                return (
                  <div
                    key={o.id}
                    id={o.id}
                    role="option"
                    aria-selected={idx === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(o.href)}
                    onMouseEnter={() => setActive(idx)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                      idx === active && "bg-accent",
                    )}
                  >
                    {g.key === "products" ? (
                      <span className="image-placeholder flex size-9 shrink-0 items-center justify-center border text-muted-foreground">
                        <CategoryIcon name={o.icon} className="size-4" />
                      </span>
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{o.label}</span>
                      {o.meta ? (
                        <span className="model-number truncate text-xs text-muted-foreground">
                          {o.meta}
                        </span>
                      ) : null}
                    </span>
                    {o.exact ? (
                      <span className="ml-auto shrink-0 border px-1.5 text-[11px] text-primary">
                        Exact model match
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
