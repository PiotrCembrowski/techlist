import Link from "next/link";
import { AdminTable, StatusPill } from "@/components/admin/fields";
import { requireAdmin } from "@/lib/auth/guard";
import { listRetailers } from "@/modules/retailers/service";

export const metadata = { title: "Retailers" };

export default async function RetailersAdmin() {
  const { ctx } = await requireAdmin();
  const rows = await listRetailers(ctx.db);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl">Retailers</h1>
        <Link
          href="/admin/retailers/new"
          className="flex h-10 items-center border border-primary bg-primary px-4 font-heading font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          New retailer
        </Link>
      </div>
      <AdminTable
        head={["Retailer", "Country", "Currencies", "Redirect hosts", "Status"]}
        empty={rows.length ? undefined : "No retailers yet."}
      >
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <Link href={`/admin/retailers/${r.id}`} className="font-medium text-primary">
                {r.name}
              </Link>
            </td>
            <td>{r.countryCode}</td>
            <td>{r.supportedCurrencies.join(", ")}</td>
            <td className="text-muted-foreground">{r.allowedRedirectHosts.join(", ") || "—"}</td>
            <td>
              <div className="flex flex-wrap gap-1">
                <StatusPill value={r.isActive ? "active" : "inactive"} />
                {r.isDemo ? <StatusPill value="demo" /> : null}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </>
  );
}
