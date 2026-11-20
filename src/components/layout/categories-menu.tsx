"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { Popover } from "radix-ui";
import { useState } from "react";
import { CategoryIcon } from "@/components/product/image-placeholder";
import type { NavCategory } from "@/modules/catalog/pages";

/** Mega-menu of categories with their subcategories and product counts. */
export function CategoriesMenu({ categories }: { categories: NavCategory[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="flex h-9 items-center gap-1 px-1 text-sm font-medium hover:text-primary data-[state=open]:text-primary">
        Categories
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-3.5 transition-transform data-[state=open]:rotate-180"
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={14}
          className="blueprint z-50 w-[min(760px,calc(100vw-32px))] bg-popover p-0 shadow-[0_12px_32px_rgba(43,43,45,0.22)] data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <i aria-hidden="true" className="corner tl" />
          <i aria-hidden="true" className="corner tr" />
          <i aria-hidden="true" className="corner bl" />
          <i aria-hidden="true" className="corner br" />
          <ul className="grid grid-cols-2 md:grid-cols-3">
            {categories.map((c) => (
              <li
                key={c.slug}
                className="border-r border-b p-4 [&:nth-child(2n)]:border-r-0 md:[&:nth-child(2n)]:border-r md:[&:nth-child(3n)]:border-r-0"
              >
                <Link
                  href={`/categories/${c.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 font-heading text-lg font-semibold hover:text-primary"
                >
                  <CategoryIcon name={c.icon} className="size-4" />
                  {c.name}
                </Link>
                <span className="text-xs text-muted-foreground">{c.productCount} products</span>
                {c.children.length ? (
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {c.children.map((ch) => (
                      <li key={ch.slug}>
                        <Link
                          href={`/categories/${ch.slug}`}
                          onClick={() => setOpen(false)}
                          className="text-primary hover:text-primary-active"
                        >
                          {ch.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex justify-end px-4 py-2.5 text-sm">
            <Link
              href="/categories"
              onClick={() => setOpen(false)}
              className="text-primary hover:text-primary-active"
            >
              All categories
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
