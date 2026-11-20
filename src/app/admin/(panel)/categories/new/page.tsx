import { ActionForm } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminOptions } from "@/modules/admin/queries";
import { createCategoryAction } from "../actions";
import { CategoryFields } from "../category-form";

export const metadata = { title: "New category" };

export default async function NewCategory() {
  const { ctx } = await requireAdmin();
  const { categories } = await getAdminOptions(ctx.db);
  return (
    <>
      <h1 className="text-4xl">New category</h1>
      <ActionForm action={createCategoryAction} aria-label="New category" className="max-w-[860px]">
        <CategoryFields parents={categories} />
      </ActionForm>
    </>
  );
}
