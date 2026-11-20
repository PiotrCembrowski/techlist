import Link from "next/link";
import { AdminTable } from "@/components/admin/fields";
import { getEnv } from "@/config/env";
import { requireAdmin } from "@/lib/auth/guard";
import { formatRelative } from "@/lib/format";
import { getDashboardStats, listAuditLogs, listRecentImports } from "@/modules/admin/queries";

export const metadata = { title: "Dashboard" };

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <span className="label-caps">{label}</span>
      <span className="font-heading text-3xl font-semibold">{value}</span>
    </>
  );
  return href ? (
    <Link href={href} className="flex flex-col gap-1 border p-4 hover:bg-accent">
      {body}
    </Link>
  ) : (
    <div className="flex flex-col gap-1 border p-4">{body}</div>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { ctx } = await requireAdmin();
  const [stats, imports, audit] = await Promise.all([
    getDashboardStats(ctx.db, getEnv().OFFER_STALE_HOURS),
    listRecentImports(ctx.db),
    listAuditLogs(ctx.db, {}),
  ]);
  const forbidden = (await searchParams).error === "forbidden";
  return (
    <>
      <h1 className="text-4xl">Dashboard</h1>
      {forbidden ? (
        <p role="alert" className="border border-destructive/40 px-3 py-2 text-sm text-destructive">
          That page needs the owner role.
        </p>
      ) : null}
      <section aria-labelledby="products-stats" className="flex flex-col gap-3">
        <h2 id="products-stats" className="text-2xl">
          Products
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {["published", "draft", "archived"].map((s) => (
            <Stat
              key={s}
              label={s}
              value={stats.byPublication[s] ?? 0}
              href={`/admin/products?publication=${s}`}
            />
          ))}
          {["verified", "partially_verified", "needs_review"].map((s) => (
            <Stat
              key={s}
              label={s.replace("_", " ")}
              value={stats.byVerification[s] ?? 0}
              href={`/admin/products?verification=${s}`}
            />
          ))}
        </div>
      </section>
      <section aria-labelledby="ops-stats" className="flex flex-col gap-3">
        <h2 id="ops-stats" className="text-2xl">
          Catalogue operations
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="Variants" value={stats.variants} />
          <Stat label="Active retailers" value={stats.activeRetailers} href="/admin/retailers" />
          <Stat label="Active offers" value={stats.activeOffers} href="/admin/offers" />
          <Stat label="Stale offers" value={stats.staleOffers} href="/admin/offers?filter=stale" />
          <Stat
            label="Expired offers"
            value={stats.expiredOffers}
            href="/admin/offers?filter=expired"
          />
          <Stat label="Open review items" value={stats.openReviews} href="/admin/review" />
        </div>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="recent-imports" className="flex flex-col gap-3">
          <h2 id="recent-imports" className="text-2xl">
            Recent imports
          </h2>
          <AdminTable
            head={["File", "Type", "Status", "Rows", "When"]}
            empty={imports.length ? undefined : "No imports yet."}
          >
            {imports.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link href={`/admin/imports/${i.id}`} className="text-primary">
                    {i.file_name}
                  </Link>
                </td>
                <td>{i.import_type}</td>
                <td>{i.status}</td>
                <td>{i.total_rows}</td>
                <td>{formatRelative(new Date(i.created_at))}</td>
              </tr>
            ))}
          </AdminTable>
        </section>
        <section aria-labelledby="recent-audit" className="flex flex-col gap-3">
          <h2 id="recent-audit" className="flex items-baseline justify-between text-2xl">
            Recent changes
            <Link href="/admin/audit" className="font-sans text-sm font-normal text-primary">
              Full audit log
            </Link>
          </h2>
          <AdminTable
            head={["When", "Who", "Entity", "Action"]}
            empty={audit.items.length ? undefined : "No changes recorded yet."}
          >
            {audit.items.slice(0, 10).map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{formatRelative(new Date(a.created_at))}</td>
                <td>{a.admin_email ?? "system"}</td>
                <td>{a.entity_type.replace(/_/g, " ")}</td>
                <td>{a.action}</td>
              </tr>
            ))}
          </AdminTable>
        </section>
      </div>
    </>
  );
}
