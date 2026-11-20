import Link from "next/link";
import { AdminTable } from "@/components/admin/fields";
import { requireAdmin } from "@/lib/auth/guard";
import { formatRelative } from "@/lib/format";
import {
  countOpenReviewItems,
  listReviewItems,
  REVIEW_TYPES,
  type ReviewItemType,
} from "@/modules/review-queue/service";

export const metadata = { title: "Review queue" };

type SP = Promise<{ type?: string; status?: string; page?: string; done?: string }>;
const STATUSES = ["open", "approved", "rejected"] as const;

export default async function ReviewQueue({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireAdmin();
  const sp = await searchParams;
  const type = REVIEW_TYPES.find((t) => t.value === sp.type)?.value ?? null;
  const status = STATUSES.find((s) => s === sp.status) ?? "open";
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ items, hasNext }, open] = await Promise.all([
    listReviewItems(ctx.db, { status, type, page }),
    countOpenReviewItems(ctx.db),
  ]);
  const href = (o: { type?: ReviewItemType | null; status?: string; page?: number }) => {
    const q = new URLSearchParams();
    const t = o.type === undefined ? type : o.type;
    const s = o.status ?? status;
    if (t) q.set("type", t);
    if (s !== "open") q.set("status", s);
    if (o.page && o.page > 1) q.set("page", String(o.page));
    const qs = q.toString();
    return `/admin/review${qs ? `?${qs}` : ""}`;
  };
  const total = [...open.values()].reduce((a, b) => a + b, 0);
  const label = (t: string) => REVIEW_TYPES.find((x) => x.value === t)?.label ?? t;
  const chip = (active: boolean) =>
    `border px-3 py-1.5 ${active ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`;

  return (
    <>
      <h1 className="text-4xl">Review queue</h1>
      {sp.done ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Item {sp.done === "rejected" ? "rejected" : "approved"}. Changes were applied and recorded
          in the audit log.
        </p>
      ) : null}
      <nav aria-label="Status" className="flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={href({ status: s, page: 1 })}
            aria-current={s === status ? "page" : undefined}
            className={chip(s === status)}
          >
            {s === "open" ? `Open (${total})` : s[0]!.toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </nav>
      <nav aria-label="Item type" className="flex flex-wrap gap-2 text-sm">
        <Link
          href={href({ type: null, page: 1 })}
          aria-current={!type ? "page" : undefined}
          className={chip(!type)}
        >
          All types
        </Link>
        {REVIEW_TYPES.map((t) => (
          <Link
            key={t.value}
            href={href({ type: t.value, page: 1 })}
            aria-current={t.value === type ? "page" : undefined}
            className={chip(t.value === type)}
          >
            {t.label}
            {open.get(t.value) ? ` (${open.get(t.value)})` : ""}
          </Link>
        ))}
      </nav>
      <AdminTable
        head={["Type", "Product", "About", status === "open" ? "Waiting" : "Resolved", ""]}
        empty={items.length ? undefined : status === "open" ? "Nothing to review." : "No items."}
      >
        {items.map((i) => (
          <tr key={i.id}>
            <td className="whitespace-nowrap">{label(i.item_type)}</td>
            <td>{i.product_name ? `${i.brand_name} ${i.product_name}` : "—"}</td>
            <td className="max-w-[28rem] truncate text-muted-foreground">
              {i.summary?.replaceAll("_", " ") ?? "—"}
            </td>
            <td className="whitespace-nowrap">
              {formatRelative(new Date(i.resolved_at ?? i.created_at))}
            </td>
            <td>
              <Link href={`/admin/review/${i.id}`} className="text-primary">
                {status === "open" ? "Review" : "View"}
                <span className="sr-only">
                  {" "}
                  {label(i.item_type)} {i.product_name ?? ""}
                </span>
              </Link>
            </td>
          </tr>
        ))}
      </AdminTable>
      <nav aria-label="Pagination" className="flex gap-3 text-sm">
        {page > 1 ? (
          <Link href={href({ page: page - 1 })} className="text-primary">
            ← Newer
          </Link>
        ) : null}
        {hasNext ? (
          <Link href={href({ page: page + 1 })} className="text-primary">
            Older →
          </Link>
        ) : null}
      </nav>
    </>
  );
}
