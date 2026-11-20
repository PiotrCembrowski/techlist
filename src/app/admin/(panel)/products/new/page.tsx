import { ActionForm } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminOptions } from "@/modules/admin/queries";
import { createProductAction } from "../actions";
import { ProductFields } from "../product-form";

export const metadata = { title: "New product" };

export default async function NewProduct() {
  const { ctx } = await requireAdmin();
  const options = await getAdminOptions(ctx.db);
  return (
    <>
      <h1 className="text-4xl">New product</h1>
      <p className="text-sm text-muted-foreground">
        New products start as drafts. Add variants, specifications and sources, then publish.
      </p>
      <ActionForm action={createProductAction} aria-label="New product" className="max-w-[960px]">
        <ProductFields brands={options.brands} categories={options.categories} />
      </ActionForm>
    </>
  );
}
