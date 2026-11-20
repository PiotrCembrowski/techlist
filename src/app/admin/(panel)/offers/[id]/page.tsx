import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminSection, AdminTable } from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { retailerOffers } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guard";
import { uuidSchema } from "@/lib/validation";
import { getAdminOptions, getProductAdmin } from "@/modules/admin/queries";
import { getPriceHistory } from "@/modules/offers/service";
import { getRetailer } from "@/modules/retailers/service";
import { markOfferCheckedAction, updateOfferAction } from "../actions";
import { OfferFields } from "../offer-form";

export const metadata = { title: "Edit offer" };

type SP = Promise<{ created?: string; suspicious?: string }>;

export default async function EditOffer({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SP;
}) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const [offer] = await ctx.db
    .select()
    .from(retailerOffers)
    .where(eq(retailerOffers.id, id))
    .limit(1);
  if (!offer) notFound();
  const [data, retailer, options, history] = await Promise.all([
    getProductAdmin(ctx.db, offer.productId),
    getRetailer(ctx.db, offer.retailerId),
    getAdminOptions(ctx.db),
    getPriceHistory(ctx.db, id, 50),
  ]);
  if (!data || !retailer) notFound();
  const sp = await searchParams;
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/offers" className="text-sm text-primary">
          ← Offers
        </Link>
        <h1 className="text-4xl">
          {retailer.name} · {data.brand.name} {data.product.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Last checked {offer.lastCheckedAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·
          allowed hosts: {retailer.allowedRedirectHosts.join(", ") || "none"}
        </p>
      </div>
      {sp.created ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Offer created.
        </p>
      ) : null}
      {sp.suspicious ? (
        <p role="status" className="border border-warning/50 px-3 py-2 text-sm">
          The price differs strongly from other offers for this product; a review item was created.
        </p>
      ) : null}
      <ActionForm action={markOfferCheckedAction} aria-label="Mark checked">
        <input type="hidden" name="id" value={offer.id} />
        <SubmitButton variant="secondary">Mark as checked now</SubmitButton>
      </ActionForm>
      <AdminSection title="Offer">
        <ActionForm action={updateOfferAction} aria-label="Offer">
          <OfferFields
            offer={offer}
            variants={data.variants.map((v) => ({ value: v.id, label: v.variantName }))}
            sources={options.sources}
          />
        </ActionForm>
      </AdminSection>
      <AdminSection title="Price history">
        <AdminTable
          head={["Recorded", "Price"]}
          empty={history.length ? undefined : "No history yet."}
        >
          {history.map((h) => (
            <tr key={h.id}>
              <td>{h.recordedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              <td className="tabular-nums">
                {Number(h.priceAmount).toFixed(2)} {h.currency}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminSection>
    </>
  );
}
