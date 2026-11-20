import Link from "next/link";
import { AdminTable, StatusPill } from "@/components/admin/fields";
import { requireAdmin } from "@/lib/auth/guard";
import { listBrands } from "@/modules/brands/service";

export const metadata = { title: "Brands" };

export default async function BrandsAdmin() {
  const { ctx } = await requireAdmin();
  const brands = await listBrands(ctx.db, { limit: 200 });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl">Brands</h1>
        <Link
          href="/admin/brands/new"
          className="flex h-10 items-center border border-primary bg-primary px-4 font-heading font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          New brand
        </Link>
      </div>
      <AdminTable
        head={["Brand", "Slug", "Country", "Status"]}
        empty={brands.length ? undefined : "No brands yet."}
      >
        {brands.map((b) => (
          <tr key={b.id}>
            <td>
              <Link href={`/admin/brands/${b.id}`} className="font-medium text-primary">
                {b.name}
              </Link>
            </td>
            <td className="text-muted-foreground">{b.slug}</td>
            <td>{b.countryOfOrigin ?? "—"}</td>
            <td>
              <div className="flex flex-wrap gap-1">
                <StatusPill value={b.isActive ? "active" : "inactive"} />
                {b.isDemo ? <StatusPill value="demo" /> : null}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </>
  );
}
