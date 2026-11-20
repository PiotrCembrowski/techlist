import Link from "next/link";
import { AdminTable, StatusPill } from "@/components/admin/fields";
import { requireAdmin } from "@/lib/auth/guard";
import { listProviders } from "@/modules/providers";

export const metadata = { title: "Data providers" };

export default async function DataProviders() {
  await requireAdmin();
  const providers = listProviders();
  return (
    <>
      <h1 className="text-4xl">Data providers</h1>
      <p className="max-w-[760px] text-sm text-muted-foreground">
        Where catalogue data can come from. CSV files are fully supported. The other adapters are
        placeholders: they make no network requests and need an agreement with the provider,
        credentials in the environment and an implementation before they can be used. See{" "}
        <code>docs/DATA_SOURCES.md</code>.
      </p>
      <AdminTable head={["Provider", "Status", "Settings", "Use"]}>
        <tr>
          <td>
            <span className="font-medium">CSV file</span>
            <span className="block text-xs text-muted-foreground">
              Upload products or offers; preview, duplicate detection and review before anything
              changes.
            </span>
          </td>
          <td>
            <StatusPill value="available" />
          </td>
          <td className="text-muted-foreground">none</td>
          <td>
            <Link href="/admin/imports" className="text-primary">
              Import &amp; export
            </Link>
          </td>
        </tr>
        {providers.map((p) => (
          <tr key={p.name}>
            <td>
              <span className="font-medium">{p.name}</span>
              <span className="block text-xs text-muted-foreground">{p.description}</span>
            </td>
            <td>
              <StatusPill
                value={p.isConfigured() ? "settings present, not implemented" : "not configured"}
              />
            </td>
            <td className="font-mono text-xs text-muted-foreground">{p.requiredEnv.join(", ")}</td>
            <td className="text-muted-foreground">—</td>
          </tr>
        ))}
      </AdminTable>
    </>
  );
}
