import { ActionForm } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { findSimilarBrands } from "@/modules/catalog-admin/service";
import { createBrandAction } from "../actions";
import { BrandFields } from "../brand-form";

export const metadata = { title: "New brand" };

export default async function NewBrand({
  searchParams,
}: {
  searchParams: Promise<{ check?: string }>;
}) {
  const { ctx } = await requireAdmin();
  const check = (await searchParams).check?.trim().slice(0, 120) ?? "";
  const similar = check ? await findSimilarBrands(ctx.db, check) : [];
  return (
    <>
      <h1 className="text-4xl">New brand</h1>
      <form method="get" className="flex items-end gap-2" aria-label="Check for duplicates">
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Check for existing brands first
          <input
            name="check"
            defaultValue={check}
            className="h-10 w-64 border bg-background px-2.5 text-sm"
          />
        </label>
        <button type="submit" className="h-10 border px-3 text-sm hover:bg-accent">
          Check
        </button>
      </form>
      {check ? (
        similar.length ? (
          <div role="alert" className="border border-warning/40 px-3 py-2 text-sm text-warning">
            Possible duplicates: {similar.map((s) => s.name).join(", ")}. Add aliases to the
            existing brand instead of creating a new one.
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            No similar brand names found.
          </p>
        )
      ) : null}
      <ActionForm action={createBrandAction} aria-label="New brand" className="max-w-[860px]">
        <BrandFields />
      </ActionForm>
    </>
  );
}
