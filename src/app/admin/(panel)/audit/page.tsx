import Link from "next/link";
import { AdminTable } from "@/components/admin/fields";
import { requireAdmin } from "@/lib/auth/guard";
import { uuidSchema } from "@/lib/validation";
import { listAuditLogs } from "@/modules/admin/queries";

export const metadata = { title: "Audit log" };

type SP = Promise<{ entity?: string; id?: string; page?: string }>;

const IGNORED = new Set(["updatedAt", "createdAt"]);

function fmt(v: unknown): string {
  if (v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

/** Field-level differences between the stored before/after snapshots (already redacted). */
function changes(prev: Record<string, unknown> | null, next: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
  return [...keys]
    .filter((k) => !IGNORED.has(k) && JSON.stringify(prev?.[k]) !== JSON.stringify(next?.[k]))
    .map((k) => ({ key: k, before: prev ? fmt(prev[k]) : "—", after: next ? fmt(next[k]) : "—" }));
}

export default async function AuditLog({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireAdmin();
  const sp = await searchParams;
  const entityType = sp.entity && /^[a-z_]{1,40}$/.test(sp.entity) ? sp.entity : null;
  const entityId = sp.id && uuidSchema.safeParse(sp.id).success ? sp.id : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const { items, hasNext } = await listAuditLogs(ctx.db, { entityType, entityId, page });
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (entityType) q.set("entity", entityType);
    if (entityId) q.set("id", entityId);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `/admin/audit${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <h1 className="text-4xl">Audit log</h1>
      <form
        method="get"
        className="flex flex-wrap items-end gap-2 text-sm"
        aria-label="Filter audit log"
      >
        <label className="flex flex-col gap-1.5 text-[13px] font-medium" htmlFor="audit-entity">
          Entity type
          <input
            id="audit-entity"
            name="entity"
            defaultValue={entityType ?? ""}
            placeholder="e.g. product"
            className="h-10 border bg-background px-2.5"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium" htmlFor="audit-id">
          Entity ID
          <input
            id="audit-id"
            name="id"
            defaultValue={entityId ?? ""}
            className="h-10 w-[22rem] max-w-full border bg-background px-2.5"
          />
        </label>
        <button className="h-10 border px-4 font-heading font-semibold hover:bg-accent">
          Filter
        </button>
        {entityType || entityId ? (
          <Link href="/admin/audit" className="flex h-10 items-center px-2 text-primary">
            Clear
          </Link>
        ) : null}
      </form>
      <AdminTable
        head={["When (UTC)", "Who", "Action", "Entity", "Changes"]}
        empty={items.length ? undefined : "No audit entries."}
      >
        {items.map((a) => {
          const diff = changes(a.previous_data, a.new_data);
          return (
            <tr key={a.id}>
              <td className="whitespace-nowrap">{a.created_at.slice(0, 19)}</td>
              <td>{a.admin_email ?? "system"}</td>
              <td>{a.action}</td>
              <td>
                {a.entity_id ? (
                  <Link
                    href={`/admin/audit?entity=${a.entity_type}&id=${a.entity_id}`}
                    className="text-primary"
                  >
                    {a.entity_type}
                  </Link>
                ) : (
                  a.entity_type
                )}
              </td>
              <td>
                {diff.length ? (
                  <details>
                    <summary className="cursor-pointer">
                      {diff.length} field{diff.length === 1 ? "" : "s"}:{" "}
                      {diff
                        .slice(0, 4)
                        .map((d) => d.key)
                        .join(", ")}
                      {diff.length > 4 ? "…" : ""}
                    </summary>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                      {diff.map((d) => (
                        <div key={d.key} className="contents">
                          <dt className="font-medium">{d.key}</dt>
                          <dd className="break-all">
                            <span className="text-muted-foreground line-through">{d.before}</span> →{" "}
                            {d.after}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </AdminTable>
      <nav aria-label="Pagination" className="flex gap-3 text-sm">
        {page > 1 ? (
          <Link href={href(page - 1)} className="text-primary">
            ← Newer
          </Link>
        ) : null}
        {hasNext ? (
          <Link href={href(page + 1)} className="text-primary">
            Older →
          </Link>
        ) : null}
      </nav>
    </>
  );
}
