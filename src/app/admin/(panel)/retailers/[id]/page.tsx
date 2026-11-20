import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { uuidSchema } from "@/lib/validation";
import { getRetailer } from "@/modules/retailers/service";
import { updateRetailerAction } from "../actions";
import { RetailerFields } from "../retailer-form";

export const metadata = { title: "Edit retailer" };

export default async function EditRetailer({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const retailer = await getRetailer(ctx.db, id);
  if (!retailer) notFound();
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/retailers" className="text-sm text-primary">
          ← Retailers
        </Link>
        <h1 className="text-4xl">{retailer.name}</h1>
      </div>
      {(await searchParams).created ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Retailer created.
        </p>
      ) : null}
      <ActionForm action={updateRetailerAction} aria-label="Retailer" className="max-w-[860px]">
        <RetailerFields retailer={retailer} />
      </ActionForm>
      <Link href={`/admin/offers/new?retailer=${retailer.id}`} className="text-sm text-primary">
        Add an offer from this retailer →
      </Link>
    </>
  );
}
