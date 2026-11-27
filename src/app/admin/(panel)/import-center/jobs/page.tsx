import Link from "next/link";
import { AdminTable, StatusPill } from "@/components/admin/fields";
import { requireAdmin } from "@/lib/auth/guard";
import { formatRelative } from "@/lib/format";
import type { JobQuery } from "@/modules/import-jobs/service";
import { describeQuery } from "../describe";
import { listProviderJobs } from "@/modules/import-jobs/service";
import { AutoRefresh } from "../auto-refresh";
import { ImportCenterHeader } from "../tabs";

export const metadata = { title: "Import jobs" };

export default async function Jobs() {
  const { ctx } = await requireAdmin();
  const jobs = await listProviderJobs(ctx.db);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  return (
    <>
      <ImportCenterHeader current="/admin/import-center/jobs" title="Jobs" />
      <AutoRefresh active={active} />
      <p className="text-sm text-muted-foreground">
        Jobs run in the worker (<code>pnpm worker</code> or the scheduled workflow), not in the web
        app. Counts: discovered = items; needs review includes records waiting for a mapping.
      </p>
      <AdminTable
        label="Import jobs"
        head={[
          "Job",
          "Provider",
          "Query",
          "Status",
          "Discovered",
          "Imported",
          "Unchanged",
          "Skipped",
          "Needs review",
          "Failed",
          "Started",
          "Finished",
        ]}
        empty={jobs.length ? undefined : "No provider jobs yet."}
      >
        {jobs.map((j) => (
          <tr key={j.id}>
            <td>
              <Link
                href={`/admin/import-center/jobs/${j.id}`}
                className="font-mono text-xs text-primary"
              >
                {j.id.slice(0, 8)}
              </Link>
            </td>
            <td>{j.provider}</td>
            <td className="text-xs">{describeQuery(j.query as JobQuery)}</td>
            <td>
              <StatusPill value={j.status === "committed" ? "finished" : j.status} />
            </td>
            <td>{Object.values(j.counts).reduce((a, b) => a + b, 0)}</td>
            <td>{j.counts.applied ?? 0}</td>
            <td>{j.counts.unchanged ?? 0}</td>
            <td>{j.counts.skipped ?? 0}</td>
            <td>{j.counts.needs_review ?? 0}</td>
            <td>{j.counts.failed ?? 0}</td>
            <td className="text-xs whitespace-nowrap">
              {j.startedAt ? formatRelative(j.startedAt) : "—"}
            </td>
            <td className="text-xs whitespace-nowrap">
              {j.completedAt ? formatRelative(j.completedAt) : "—"}
            </td>
          </tr>
        ))}
      </AdminTable>
    </>
  );
}
