"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { NavCategory } from "@/modules/catalog/pages";
import { MarketSelector, type MarketOption } from "./market-selector";
import { ThemeToggle } from "./theme-toggle";

/** Mobile navigation: a full-height sheet with the same destinations as the desktop header. */
export function MobileNav({
  categories,
  market,
  markets,
}: {
  categories: NavCategory[];
  market: string;
  markets: MarketOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="secondary" size="icon" className="size-11" aria-label="Open menu">
          <Menu strokeWidth={1.5} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(43,43,45,0.5)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(360px,100vw)] flex-col overflow-y-auto border-l bg-background data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
          <div className="flex h-16 items-center justify-between border-b px-4">
            <Dialog.Title className="font-heading text-lg font-semibold tracking-[0.04em] uppercase">
              Menu
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="secondary" size="icon" className="size-11" aria-label="Close menu">
                <X strokeWidth={1.5} />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Site navigation, market and theme
          </Dialog.Description>
          <nav
            aria-label="Mobile"
            className="flex flex-col"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            <span className="label-caps px-4 pt-4 pb-1">Categories</span>
            <ul>
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/categories/${c.slug}`}
                    className="flex min-h-11 items-center justify-between px-4 font-medium hover:bg-accent"
                  >
                    {c.name}
                    <span className="text-xs text-muted-foreground">{c.productCount}</span>
                  </Link>
                  {c.children.map((ch) => (
                    <Link
                      key={ch.slug}
                      href={`/categories/${ch.slug}`}
                      className="flex min-h-11 items-center pl-8 text-sm text-primary hover:bg-accent"
                    >
                      {ch.name}
                    </Link>
                  ))}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-col border-t">
              {[
                { href: "/products", label: "All products" },
                { href: "/brands", label: "Brands" },
                { href: "/guides", label: "Guides" },
                { href: "/search", label: "Search" },
                { href: "/compare", label: "Compare" },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="flex min-h-11 items-center px-4 font-medium hover:bg-accent"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </nav>
          <div className="mt-auto flex items-end gap-3 border-t p-4">
            <div className="flex flex-1 flex-col gap-1">
              <span className="label-caps">Market</span>
              <MarketSelector value={market} options={markets} id="market-select-mobile" />
            </div>
            <ThemeToggle />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
