import Link from "next/link";
import { siteConfig } from "@/config/site";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/affiliate-disclosure", label: "Affiliate disclosure" },
  { href: "/data-policy", label: "Data & verification policy" },
  { href: "/privacy", label: "Privacy" },
];

export function SiteFooter({ demo }: { demo: boolean }) {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-10 text-sm text-muted-foreground sm:px-6 md:grid-cols-[1fr_1fr_2fr] lg:px-10">
        <div className="flex flex-col gap-1">
          <span className="font-heading text-base font-semibold tracking-[0.04em] text-foreground uppercase">
            {siteConfig.name}
          </span>
          <span>{siteConfig.tagline}</span>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-col gap-1.5">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-foreground hover:text-primary">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col gap-2">
          <p>
            <span className="font-medium text-foreground">Affiliate disclosure.</span> We may earn a
            commission when you buy through retailer links. It never changes which offers we list or
            their order. There are no ratings, scores or &ldquo;winners&rdquo; on this site.{" "}
            <Link href="/affiliate-disclosure" className="text-primary">
              Read more
            </Link>
          </p>
          {demo ? (
            <p>
              All products, brands, retailers and offers currently shown are fictional demonstration
              data.
            </p>
          ) : null}
          <p>
            © {new Date().getUTCFullYear()} {siteConfig.name}
          </p>
        </div>
      </div>
    </footer>
  );
}
