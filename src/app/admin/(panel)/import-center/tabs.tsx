import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/import-center", label: "Providers" },
  { href: "/admin/import-center/discover", label: "Discover" },
  { href: "/admin/import-center/jobs", label: "Jobs" },
  { href: "/admin/import-center/mappings", label: "Mappings" },
  { href: "/admin/import-center/coverage", label: "Coverage" },
  { href: "/admin/review", label: "Review queue" },
];

export function ImportCenterHeader({ current, title }: { current: string; title: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="label-caps text-muted-foreground">Product Import Center</p>
      <h1 className="text-4xl">{title}</h1>
      <nav aria-label="Import Center">
        <ul className="flex flex-wrap gap-1 border-b">
          {TABS.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={t.href === current ? "page" : undefined}
                className={cn(
                  "block border-b-2 px-3 py-2 text-sm hover:bg-accent",
                  t.href === current ? "border-primary font-medium" : "border-transparent",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
