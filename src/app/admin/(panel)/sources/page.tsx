import Link from "next/link";
import { AdminTable, StatusPill } from "@/components/admin/fields";
import { requireAdmin } from "@/lib/auth/guard";
import { listSources } from "@/modules/sources/service";

export const metadata = { title: "Sources" };

export default async function SourcesAdmin() {
  const { ctx } = await requireAdmin();
  const rows = await listSources(ctx.db);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl">Sources</h1>
        <Link
          href="/admin/sources/new"
          className="flex h-10 items-center border border-primary bg-primary px-4 font-heading font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          New source
        </Link>
      </div>
      <AdminTable
        head={["Source", "Type", "Licence", "Usage"]}
        empty={rows.length ? undefined : "No sources yet."}
      >
        {rows.map((s) => (
          <tr key={s.id}>
            <td>
              <Link href={`/admin/sources/${s.id}`} className="font-medium text-primary">
                {s.sourceName}
              </Link>
            </td>
            <td>{s.sourceType.replaceAll("_", " ")}</td>
            <td className="text-muted-foreground">{s.licenseType ?? "—"}</td>
            <td>
              <div className="flex flex-wrap gap-1">
                <StatusPill value={s.usagePermitted ? "permitted" : "not permitted"} />
                {s.isDemo ? <StatusPill value="demo" /> : null}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </>
  );
}
