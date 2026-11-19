import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { siteConfig } from "@/config/site";
import { ThemeToggle } from "./theme-toggle";

/**
 * Compact header. Navigation items (Categories, Brands, Compare, Guides), search and the
 * market selector are added in Stage 3 together with the routes they link to — rule 2.3.1
 * forbids links that look functional but lead nowhere.
 */
export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-4 sm:px-6 lg:px-10">
        <Link
          href="/"
          aria-label={`${siteConfig.name} home`}
          className="text-foreground no-underline"
        >
          <Wordmark />
        </Link>
        <div className="flex-1" />
        <ThemeToggle />
      </div>
    </header>
  );
}
