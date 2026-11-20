import { ActionForm } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { createRetailerAction } from "../actions";
import { RetailerFields } from "../retailer-form";

export const metadata = { title: "New retailer" };

export default async function NewRetailer() {
  await requireAdmin();
  return (
    <>
      <h1 className="text-4xl">New retailer</h1>
      <ActionForm action={createRetailerAction} aria-label="New retailer" className="max-w-[860px]">
        <RetailerFields />
      </ActionForm>
    </>
  );
}
