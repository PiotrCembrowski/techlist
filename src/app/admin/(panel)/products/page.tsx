import Link from "next/link";
import { AdminTable, StatusPill } from "@/components/admin/fields";
import { Pagination } from "@/components/catalog/pagination";
import { requireAdmin } from "@/lib/auth/guard";
import { formatRelative } from "@/lib/format";
import { listProductsAdmin } from "@/modules/admin/queries";
import { CATALOG_STATUSES, isCatalogStatus, STATUS_LABELS } from "@/modules/products/status";

export const metadata = { title: "Products" };

type SP = Promise<{
  q?: string;
  status?: string;
  page?: string;
  deleted?: string;
}>;

export default async function ProductsAdmin({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireAdmin();
  const sp = await searchParams;
  const filters = {
    q: sp.q?.trim().slice(0, 100) || null,
    status: isCatalogStatus(sp.status) ? sp.status : null,
    page: Math.max(1, Number(sp.page) || 1),
  };
  const result = await listProductsAdmin(ctx.db, filters);
  const qs = (page: number) => {
    const p = new URLSearchParams();
    if (filters.q) p.set("q", filters.q);
    if (filters.status) p.set("status", filters.status);
    if (page > 1) p.set("page", String(page));
    return `/admin/products${p.size ? `?${p}` : ""}`;
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl">Products</h1>
        <Link
          href="/admin/products/new"
          className="flex h-10 items-center border border-primary bg-primary px-4 font-heading font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          New product
        </Link>
      </div>
      {sp.deleted ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Product deleted.
        </p>
      ) : null}
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filter products">
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Search
          <input
            name="q"
            type="search"
            defaultValue={filters.q ?? ""}
            placeholder="Name, model number, brand"
            className="h-10 w-64 border bg-background px-2.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Status
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            className="h-10 border bg-background px-2.5 text-sm"
          >
            <option value="">Any</option>
            {CATALOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-10 border px-4 text-sm hover:bg-accent">
          Filter
        </button>
      </form>
      <p className="text-sm text-muted-foreground" role="status">
        {result.total} products
      </p>
      <AdminTable
        head={["Product", "Brand", "Category", "Model", "Status", "Updated"]}
        empty={result.items.length ? undefined : "No products match."}
      >
        {result.items.map((p) => (
          <tr key={p.id}>
            <td>
              <Link href={`/admin/products/${p.id}`} className="font-medium text-primary">
                {p.name}
              </Link>
            </td>
            <td>{p.brand_name}</td>
            <td>{p.category_name}</td>
            <td className="model-number text-xs">{p.model_number}</td>
            <td>
              <StatusPill value={p.status} />
            </td>
            <td className="whitespace-nowrap text-muted-foreground">
              {formatRelative(new Date(p.updated_at))}
            </td>
          </tr>
        ))}
      </AdminTable>
      <Pagination page={result.page} pageCount={result.pageCount} hrefFor={qs} />
    </>
  );
}
