import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { requireAdmin } from "@/lib/auth/guard";
import { logoutAction } from "./session-actions";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/brands", label: "Brands" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/retailers", label: "Retailers" },
  { href: "/admin/offers", label: "Offers" },
  { href: "/admin/sources", label: "Sources" },
  { href: "/admin/review", label: "Review queue" },
  { href: "/admin/import-center", label: "Import Center" },
  { href: "/admin/imports", label: "CSV import & export" },
  { href: "/admin/data-sources", label: "Data providers" },
  { href: "/admin/audit", label: "Audit log" },
];

/** Every page below also calls requireAdmin() itself; this layout check is not the only gate. */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const { user } = await requireAdmin();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-4 border-b px-4 lg:px-6">
        <Link href="/admin" className="flex items-center gap-3 text-foreground">
          <Wordmark />
          <span className="label-caps">Admin</span>
        </Link>
        <div className="flex-1" />
        <Link href="/" className="hidden text-sm text-primary sm:inline">
          View site
        </Link>
        <span className="hidden text-sm text-muted-foreground md:inline">
          {user.email} · {user.role}
        </span>
        <ThemeToggle />
        <form action={logoutAction}>
          <button type="submit" className="h-9 border px-3 text-sm hover:bg-accent">
            Sign out
          </button>
        </form>
      </header>
      <div className="flex flex-1 flex-col lg:flex-row">
        <nav aria-label="Admin" className="border-b lg:w-52 lg:border-r lg:border-b-0">
          <ul className="flex gap-1 overflow-x-auto p-2 lg:flex-col">
            {[
              ...NAV,
              ...(user.role === "owner" ? [{ href: "/admin/users", label: "Users" }] : []),
            ].map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className="block px-3 py-2 text-sm whitespace-nowrap hover:bg-accent"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" className="flex min-w-0 flex-1 flex-col gap-6 p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
