import { Search } from "lucide-react";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { SearchBox } from "@/components/search/search-box";
import { siteConfig } from "@/config/site";
import { getDb } from "@/lib/db";
import { marketName } from "@/lib/format";
import { getSelectedMarket } from "@/lib/market/server";
import { getCategoryTree } from "@/modules/catalog/pages";
import { listMarkets } from "@/modules/offers/read";
import { CategoriesMenu } from "./categories-menu";
import { MarketSelector } from "./market-selector";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * Compact header: wordmark, Categories (mega-menu), Products, Brands, Guides, search with
 * suggestions, market selector, theme. The Compare link (with tray count) arrives in Stage 4
 * together with the comparison page — no links to pages that do not exist yet (rule 2.3.1).
 */
export async function SiteHeader() {
  const db = getDb();
  const [categories, marketCodes, market] = await Promise.all([
    getCategoryTree(db),
    listMarkets(db),
    getSelectedMarket(),
  ]);
  const codes =
    marketCodes.includes(market) || market === "ALL"
      ? marketCodes
      : [...marketCodes, market].sort();
  const markets = [
    { code: "ALL", label: "All markets" },
    ...codes.map((c) => ({ code: c, label: `${marketName(c)} · ${c}` })),
  ];

  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-5 px-4 sm:px-6 lg:px-10">
        <Link
          href="/"
          aria-label={`${siteConfig.name} home`}
          className="shrink-0 text-foreground no-underline"
        >
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-5 text-sm font-medium lg:flex">
          <CategoriesMenu categories={categories} />
          <Link href="/products" className="hover:text-primary">
            Products
          </Link>
          <Link href="/brands" className="hover:text-primary">
            Brands
          </Link>
          <Link href="/guides" className="hover:text-primary">
            Guides
          </Link>
        </nav>
        <SearchBox className="hidden max-w-[420px] flex-1 lg:block" />
        <div className="flex-1 lg:hidden" />
        <div className="ml-auto hidden items-center gap-3 lg:flex">
          <MarketSelector value={market} options={markets} className="w-[200px]" />
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          <Link
            href="/search"
            aria-label="Search"
            className="flex size-11 items-center justify-center border hover:bg-accent"
          >
            <Search strokeWidth={1.5} className="size-4" />
          </Link>
          <MobileNav categories={categories} market={market} markets={markets} />
        </div>
      </div>
    </header>
  );
}
