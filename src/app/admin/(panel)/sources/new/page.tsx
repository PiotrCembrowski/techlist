import { ActionForm } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { createSourceAction } from "../actions";
import { SourceFields } from "../source-form";

export const metadata = { title: "New source" };

export default async function NewSource() {
  await requireAdmin();
  return (
    <>
      <h1 className="text-4xl">New source</h1>
      <ActionForm action={createSourceAction} aria-label="New source" className="max-w-[860px]">
        <SourceFields />
      </ActionForm>
    </>
  );
}
