import { sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminSection, AdminTable, StatusPill } from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { formatDate } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { baseColumns, REQUIRED_COLUMNS, SPEC_PREFIX } from "@/modules/imports/columns";
import {
  countImportRows,
  getImportJob,
  listImportRows,
  orderedHeaders,
} from "@/modules/imports/service";
import type { RowAction } from "@/modules/imports/types";
import { cancelImportAction, commitImportAction, mapAndValidateAction } from "../actions";

export const metadata = { title: "Import" };

const ACTIONS: { value: RowAction; label: string }[] = [
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "skip", label: "Skip" },
  { value: "conflict", label: "Conflict" },
  { value: "error", label: "Error" },
];

type SP = Promise<{ action?: string; page?: string; committed?: string }>;

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SP;
}) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const found = await getImportJob(ctx.db, id);
  if (!found) notFound();
  const { job, sourceName } = found;
  const sp = await searchParams;
  const action = ACTIONS.find((a) => a.value === sp.action)?.value ?? null;
  const page = Math.max(1, Number(sp.page) || 1);
  const [counts, rows] = await Promise.all([
    countImportRows(ctx.db, id),
    listImportRows(ctx.db, id, { action, page }),
  ]);
  const headers = orderedHeaders(job);
  const sample = (await listImportRows(ctx.db, id, { page: 1 })).items[0]?.raw ?? {};
  const validated = job.status === "validated" || job.status === "committed";
  const editable = job.status === "uploaded" || job.status === "validated";
  const problems = counts.error + counts.conflict;

  // Mapping targets: the template columns plus spec.<key> for every definition (products).
  const specKeys =
    job.importType === "products"
      ? (
          await ctx.db.execute<{ key: string }>(
            sql`SELECT DISTINCT key FROM specification_definitions ORDER BY key LIMIT 2000`,
          )
        ).map((r) => `${SPEC_PREFIX}${r.key}`)
      : [];
  const targets = [...baseColumns(job.importType), ...specKeys];
  const required = new Set(REQUIRED_COLUMNS[job.importType]);
  const href = (a: RowAction | null, p = 1) =>
    `/admin/imports/${id}?${a ? `action=${a}&` : ""}${p > 1 ? `page=${p}` : ""}`.replace(
      /[?&]$/,
      "",
    );

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/imports" className="text-sm text-primary">
          ← Import &amp; export
        </Link>
        <h1 className="text-4xl break-all">{job.fileName}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusPill value={job.status} /> {job.importType} · {job.totalRows} rows · source:{" "}
          {sourceName} · uploaded {formatDate(job.createdAt)}
        </p>
      </div>
      {sp.committed ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Import committed: {job.successfulRows} rows applied, {job.skippedRows} skipped,{" "}
          {job.failedRows} not applied.
          {counts.conflict ? " Conflicts are waiting in the review queue." : ""}
        </p>
      ) : null}

      {editable ? (
        <AdminSection title="1. Map columns">
          <p className="text-sm text-muted-foreground">
            Columns were matched by name. Change any that are wrong; unmapped columns are ignored.
            Empty cells never clear stored values.
          </p>
          <ActionForm action={mapAndValidateAction} aria-label="Column mapping">
            <input type="hidden" name="id" value={job.id} />
            <AdminTable head={["Column in the file", "First row", "Imports into"]}>
              {headers.map((h, i) => (
                <tr key={h}>
                  <td className="font-medium">
                    <label htmlFor={`map-${i}`}>{h}</label>
                  </td>
                  <td className="max-w-[16rem] truncate text-muted-foreground">
                    {sample[h] || "—"}
                  </td>
                  <td>
                    <select
                      id={`map-${i}`}
                      name={`map.${h}`}
                      defaultValue={job.columnMapping[h] ?? ""}
                      className="h-9 w-full min-w-48 border bg-background px-2 text-sm"
                    >
                      <option value="">— ignore —</option>
                      {targets.map((t) => (
                        <option key={t} value={t}>
                          {t}
                          {required.has(t) ? " (required)" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </AdminTable>
            <SubmitButton>{validated ? "Validate again" : "Validate rows"}</SubmitButton>
          </ActionForm>
        </AdminSection>
      ) : null}

      {validated ? (
        <AdminSection title={job.status === "committed" ? "Result" : "2. Preview"}>
          <nav aria-label="Rows by action" className="flex flex-wrap gap-2 text-sm">
            <Link
              href={href(null)}
              aria-current={!action ? "page" : undefined}
              className={`border px-3 py-1.5 ${!action ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              All ({job.totalRows})
            </Link>
            {ACTIONS.map((a) => (
              <Link
                key={a.value}
                href={href(a.value)}
                aria-current={action === a.value ? "page" : undefined}
                className={`border px-3 py-1.5 ${action === a.value ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                {a.label}: {counts[a.value]}
              </Link>
            ))}
          </nav>
          <AdminTable
            head={["Row", "Action", "Row", "What happens / problems"]}
            empty={rows.items.length ? undefined : "No rows."}
          >
            {rows.items.map((r) => {
              const n = r.normalized as {
                notes?: string[];
                data?: Record<string, unknown> | null;
              } | null;
              const label =
                job.importType === "products"
                  ? [
                      r.raw[headers.find((h) => job.columnMapping[h] === "brand") ?? ""],
                      r.raw[headers.find((h) => job.columnMapping[h] === "product_name") ?? ""],
                      r.raw[headers.find((h) => job.columnMapping[h] === "variant_name") ?? ""],
                    ]
                  : [
                      r.raw[headers.find((h) => job.columnMapping[h] === "retailer_slug") ?? ""],
                      r.raw[
                        headers.find((h) => job.columnMapping[h] === "product_model_number") ?? ""
                      ] || r.raw[headers.find((h) => job.columnMapping[h] === "gtin") ?? ""],
                      r.raw[
                        headers.find((h) => job.columnMapping[h] === "market_country_code") ?? ""
                      ],
                    ];
              return (
                <tr key={r.id}>
                  <td className="tabular-nums">{r.rowNumber}</td>
                  <td>
                    <StatusPill value={r.action ?? "—"} />
                  </td>
                  <td>{label.filter(Boolean).join(" · ") || "—"}</td>
                  <td>
                    {r.errors.length ? (
                      <ul className="text-destructive">
                        {r.errors.map((e, i) => (
                          <li key={i}>
                            {e.field ? <span className="font-medium">{e.field}: </span> : null}
                            {e.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {n?.notes?.length ? (
                      <span className="text-muted-foreground">{n.notes.join(" · ")}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </AdminTable>
          <nav aria-label="Pagination" className="flex gap-3 text-sm">
            {page > 1 ? (
              <Link href={href(action, page - 1)} className="text-primary">
                ← Previous
              </Link>
            ) : null}
            {rows.hasNext ? (
              <Link href={href(action, page + 1)} className="text-primary">
                Next →
              </Link>
            ) : null}
          </nav>
          {problems ? (
            <a
              href={`/admin/imports/${id}/errors`}
              className="w-fit border px-3 py-2 text-sm font-medium hover:bg-accent"
              download
            >
              Download error report ({problems} rows)
            </a>
          ) : null}
        </AdminSection>
      ) : null}

      {job.status === "validated" ? (
        <AdminSection title="3. Commit">
          <p className="text-sm">
            {counts.create} rows create records and {counts.update} update existing ones.{" "}
            {counts.skip} rows change nothing. Rows with errors are not imported; conflicts go to
            the review queue. The plan is checked again when you commit.
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionForm
              action={commitImportAction}
              aria-label="Commit import"
              confirm={`Commit ${counts.create + counts.update} rows? This changes the catalogue.`}
            >
              <input type="hidden" name="id" value={job.id} />
              <SubmitButton>Commit import</SubmitButton>
            </ActionForm>
            <ActionForm action={cancelImportAction} aria-label="Cancel import">
              <input type="hidden" name="id" value={job.id} />
              <SubmitButton variant="secondary">Cancel import</SubmitButton>
            </ActionForm>
          </div>
        </AdminSection>
      ) : job.status === "uploaded" ? (
        <ActionForm action={cancelImportAction} aria-label="Cancel import">
          <input type="hidden" name="id" value={job.id} />
          <SubmitButton variant="secondary">Cancel import</SubmitButton>
        </ActionForm>
      ) : null}
    </>
  );
}
