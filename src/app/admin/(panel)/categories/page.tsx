import Link from "next/link";
import { AdminTable, StatusPill } from "@/components/admin/fields";
import { requireAdmin } from "@/lib/auth/guard";
import { listCategories } from "@/modules/categories/service";

export const metadata = { title: "Categories" };

export default async function CategoriesAdmin() {
  const { ctx } = await requireAdmin();
  const all = await listCategories(ctx.db, { limit: 200 });
  const roots = all.filter((c) => !c.parentId);
  const rows = roots.flatMap((r) => [
    { c: r, depth: 0 },
    ...all.filter((c) => c.parentId === r.id).map((c) => ({ c, depth: 1 })),
  ]);
  const orphans = all
    .filter((c) => c.parentId && !all.some((p) => p.id === c.parentId))
    .map((c) => ({ c, depth: 0 }));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl">Categories</h1>
        <Link
          href="/admin/categories/new"
          className="flex h-10 items-center border border-primary bg-primary px-4 font-heading font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          New category
        </Link>
      </div>
      <AdminTable
        head={["Category", "Slug", "Order", "Status"]}
        empty={all.length ? undefined : "No categories yet."}
      >
        {[...rows, ...orphans].map(({ c, depth }) => (
          <tr key={c.id}>
            <td style={{ paddingLeft: `${12 + depth * 24}px` }}>
              <Link href={`/admin/categories/${c.id}`} className="font-medium text-primary">
                {depth ? "↳ " : ""}
                {c.name}
              </Link>
            </td>
            <td className="text-muted-foreground">{c.slug}</td>
            <td>{c.sortOrder}</td>
            <td>
              <StatusPill value={c.isActive ? "active" : "inactive"} />
            </td>
          </tr>
        ))}
      </AdminTable>
    </>
  );
}
