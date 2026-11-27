import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminSection, AdminTable, StatusPill } from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { formatRelative } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import type { RecordPreview } from "@/modules/import-jobs/preview";
import { getProviderJob, type JobQuery } from "@/modules/import-jobs/service";
import { cancelJobAction, importFromPreviewAction, retryJobAction } from "../../actions";
import { AutoRefresh } from "../../auto-refresh";
import { ImportCenterHeader } from "../../tabs";
import { describeQuery } from "../../describe";

export const metadata = { title: "Import job" };

type Result = {
  preview?: RecordPreview[];
  records?: {
    providerProductId: string;
    status: string;
    productId: string | null;
    notes: string[];
    reviewItemIds: string[];
  }[];
  notFound?: boolean;
};

export default async function JobDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ queued?: string }>;
}) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getProviderJob(ctx.db, id);
  if (!data) notFound();
  const { job, items } = data;
  const sp = await searchParams;
  const q = job.query as JobQuery;
  const active = job.status === "queued" || job.status === "running";
  const previews = items.flatMap((i) =>
    ((i.result as Result | null)?.preview ?? []).map((p) => ({ item: i, p })),
  );
  const eligible = previews.filter(({ p }) => p.eligible);
  const failed = items.filter((i) => i.status === "failed").length;

  return (
    <>
      <ImportCenterHeader current="/admin/import-center/jobs" title={`Job ${job.id.slice(0, 8)}`} />
      <AutoRefresh active={active} />
      {sp.queued ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Queued. The worker picks it up on its next run (<code>pnpm worker</code> locally, or the
          scheduled workflow).
        </p>
      ) : null}
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Provider</dt>
        <dd>{job.provider}</dd>
        <dt className="text-muted-foreground">Query</dt>
        <dd>{describeQuery(q)}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <StatusPill value={job.status === "committed" ? "finished" : job.status} />
          {job.cancelRequestedAt && job.status === "running" ? " (cancel requested)" : ""}
          {job.status === "queued" && job.runAfter > new Date()
            ? ` · resumes ${formatRelative(job.runAfter)}`
            : ""}
        </dd>
        <dt className="text-muted-foreground">Items</dt>
        <dd>
          {items.length}
          {(job.checkpoint as { totalHits?: number } | null)?.totalHits !== undefined
            ? ` (search found ${(job.checkpoint as { totalHits: number }).totalHits})`
            : ""}
        </dd>
        <dt className="text-muted-foreground">Started / finished</dt>
        <dd>
          {job.startedAt ? formatRelative(job.startedAt) : "—"} /{" "}
          {job.completedAt ? formatRelative(job.completedAt) : "—"}
        </dd>
        {job.lastError ? (
          <>
            <dt className="text-muted-foreground">Last error</dt>
            <dd className="text-destructive">{job.lastError}</dd>
          </>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {active ? (
          <ActionForm action={cancelJobAction} aria-label="Cancel job" confirm="Cancel this job?">
            <input type="hidden" name="jobId" value={job.id} />
            <SubmitButton variant="danger">Cancel job</SubmitButton>
          </ActionForm>
        ) : null}
        {!active && failed > 0 ? (
          <ActionForm action={retryJobAction} aria-label="Retry failed items">
            <input type="hidden" name="jobId" value={job.id} />
            <SubmitButton variant="secondary">Retry {failed} failed</SubmitButton>
          </ActionForm>
        ) : null}
      </div>

      {q.dryRun && previews.length ? (
        <AdminSection title="Preview" id="preview">
          <p className="text-sm text-muted-foreground">
            Nothing has been imported yet. Imported records start as “needs review”; duplicates go
            to the review queue. Records with an unknown brand or category need a mapping first.
          </p>
          <ActionForm action={importFromPreviewAction} aria-label="Import from preview">
            <input type="hidden" name="jobId" value={job.id} />
            <AdminTable
              label="Preview records"
              head={[
                "Import",
                "Record",
                "Identifiers",
                "Category",
                "Specifications",
                "Missing",
                "Match",
                "Warnings",
              ]}
            >
              {previews.map(({ p }) => (
                <tr key={p.providerProductId}>
                  <td>
                    {p.eligible ? (
                      <input
                        type="checkbox"
                        name="record"
                        value={p.providerProductId}
                        aria-label={`Import ${p.brand ?? ""} ${p.name ?? p.providerProductId}`}
                        defaultChecked={p.match.kind === "new"}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">not eligible</span>
                    )}
                  </td>
                  <td>
                    <span className="font-medium">
                      {p.brand} {p.name}
                    </span>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {p.providerProductId}
                    </span>
                  </td>
                  <td className="text-xs">
                    {[p.modelNumber, p.mpn].filter(Boolean).join(" / ") || "—"}
                    {p.gtins.length ? (
                      <span className="block font-mono">{p.gtins.join(", ")}</span>
                    ) : null}
                  </td>
                  <td className="text-xs">
                    {p.category.mappedTo ??
                      `unmapped: ${p.category.name ?? p.category.externalId ?? "—"}`}
                  </td>
                  <td className="text-xs">
                    {p.specs.map((s) => `${s.key}: ${s.value}`).join("; ") || "—"}
                    {p.unmappedFeatures ? (
                      <span className="block text-muted-foreground">
                        {p.unmappedFeatures} unmapped
                      </span>
                    ) : null}
                  </td>
                  <td className="text-xs">{p.missing.join(", ") || "—"}</td>
                  <td className="text-xs">
                    {p.match.kind === "new" ? (
                      "new product"
                    ) : p.match.kind === "existing" ? (
                      <Link href={`/admin/products/${p.match.productId}`} className="text-primary">
                        updates existing ({p.match.rule})
                      </Link>
                    ) : (
                      <>
                        review: {p.match.reason}
                        {p.match.candidates.map((c) => (
                          <span key={`${c.productId}${c.rule}`} className="block">
                            {c.name} — {c.rule}, {Math.round(c.confidence * 100)} %
                          </span>
                        ))}
                      </>
                    )}
                  </td>
                  <td className="text-xs">
                    {[...p.issues, ...p.licenceWarnings, ...p.rejectedFeatures].join("; ") || "—"}
                  </td>
                </tr>
              ))}
            </AdminTable>
            <div className="flex flex-wrap gap-2">
              <SubmitButton>Import selected</SubmitButton>
              <button
                type="submit"
                name="scope"
                value="all"
                className="h-10 border px-4 text-sm font-medium hover:bg-accent"
              >
                Import all eligible ({eligible.length})
              </button>
            </div>
          </ActionForm>
        </AdminSection>
      ) : null}

      <AdminSection title="Items" id="items">
        <AdminTable label="Job items" head={["#", "Item", "Status", "Attempts", "Result", "Error"]}>
          {items.map((i) => {
            const r = (i.result ?? {}) as Result;
            return (
              <tr key={i.id}>
                <td>{i.seq}</td>
                <td className="font-mono text-xs">{i.externalKey}</td>
                <td>
                  <StatusPill value={i.status} />
                </td>
                <td>{i.attempts}</td>
                <td className="text-xs">
                  {r.notFound ? "not returned by the provider" : null}
                  {r.preview ? `${r.preview.length} record(s) previewed` : null}
                  {r.records?.map((rec) => (
                    <span key={rec.providerProductId} className="block">
                      {rec.status}
                      {rec.productId ? (
                        <>
                          {" · "}
                          <Link href={`/admin/products/${rec.productId}`} className="text-primary">
                            product
                          </Link>
                        </>
                      ) : null}
                      {rec.reviewItemIds.length ? (
                        <>
                          {" · "}
                          <Link href="/admin/review" className="text-primary">
                            {rec.reviewItemIds.length} review item(s)
                          </Link>
                        </>
                      ) : null}
                      {rec.notes.length ? ` · ${rec.notes.join("; ")}` : ""}
                    </span>
                  ))}
                </td>
                <td className="max-w-[320px] text-xs text-destructive">{i.error}</td>
              </tr>
            );
          })}
        </AdminTable>
      </AdminSection>
    </>
  );
}
