import Link from "next/link";
import { AdminTable, StatusPill } from "@/components/admin/fields";
import { getEnv } from "@/config/env";
import { requireAdmin } from "@/lib/auth/guard";
import { uuidSchema } from "@/lib/validation";
import { listOffersAdmin, type OfferListFilter } from "@/modules/admin/queries";

export const metadata = { title: "Offers" };

const FILTERS: { value: OfferListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "stale", label: "Stale" },
  { value: "expired", label: "Expired" },
  { value: "inactive", label: "Inactive" },
];

export default async function OffersAdmin({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string; product?: string }>;
}) {
  const { ctx } = await requireAdmin();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.value === sp.filter)?.value ?? "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const staleHours = getEnv().OFFER_STALE_HOURS;
  const productId = uuidSchema.safeParse(sp.product).success ? sp.product! : null;
  const { items, hasNext } = await listOffersAdmin(ctx.db, { filter, staleHours, page, productId });
  const href = (f: OfferListFilter, p = 1) =>
    `/admin/offers?filter=${f}${productId ? `&product=${productId}` : ""}${p > 1 ? `&page=${p}` : ""}`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl">Offers</h1>
        <Link
          href={productId ? `/admin/offers/new?product=${productId}` : "/admin/offers/new"}
          className="flex h-10 items-center border border-primary bg-primary px-4 font-heading font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          New offer
        </Link>
      </div>
      <nav aria-label="Filter offers" className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={href(f.value)}
            aria-current={f.value === filter ? "page" : undefined}
            className={`border px-3 py-1.5 ${f.value === filter ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {productId ? (
        <p className="text-sm">
          Showing one product&apos;s offers.{" "}
          <Link href={`/admin/offers?filter=${filter}`} className="text-primary">
            Show all
          </Link>
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Offers are stale after {staleHours} hours without a check. Oldest checks first.
      </p>
      <AdminTable
        head={["Product", "Retailer", "Market", "Price", "Availability", "Last checked", "Status"]}
        empty={items.length ? undefined : "No offers match."}
      >
        {items.map((o) => (
          <tr key={o.id}>
            <td>
              <Link href={`/admin/offers/${o.id}`} className="font-medium text-primary">
                {o.product_name}
                {o.variant_name ? ` · ${o.variant_name}` : ""}
              </Link>
            </td>
            <td>{o.retailer_name}</td>
            <td>{o.market_country_code}</td>
            <td className="tabular-nums">
              {Number(o.price_amount).toFixed(2)} {o.currency}
            </td>
            <td>{o.availability_status.replaceAll("_", " ")}</td>
            <td className="whitespace-nowrap">{o.last_checked_at.slice(0, 16)}</td>
            <td>
              <div className="flex flex-wrap gap-1">
                {!o.is_active ? <StatusPill value="inactive" /> : null}
                {o.is_expired ? <StatusPill value="expired" /> : null}
                {o.is_stale ? <StatusPill value="stale" /> : null}
                {o.is_demo ? <StatusPill value="demo" /> : null}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
      <nav aria-label="Pagination" className="flex gap-3 text-sm">
        {page > 1 ? (
          <Link href={href(filter, page - 1)} className="text-primary">
            ← Previous
          </Link>
        ) : null}
        {hasNext ? (
          <Link href={href(filter, page + 1)} className="text-primary">
            Next →
          </Link>
        ) : null}
      </nav>
    </>
  );
}
