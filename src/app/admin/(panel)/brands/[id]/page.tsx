import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminSection } from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { uuidSchema } from "@/lib/validation";
import { getBrandById } from "@/modules/brands/service";
import { findSimilarBrands } from "@/modules/catalog-admin/service";
import { updateBrandAction, uploadBrandLogoAction } from "../actions";
import { BrandFields } from "../brand-form";

export const metadata = { title: "Edit brand" };

export default async function EditBrand({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const brand = await getBrandById(ctx.db, id);
  if (!brand) notFound();
  const similar = await findSimilarBrands(ctx.db, brand.name, brand.id);
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/brands" className="text-sm text-primary">
          ← Brands
        </Link>
        <h1 className="text-4xl">{brand.name}</h1>
        <Link href={`/brands/${brand.slug}`} className="text-sm text-primary">
          View public page
        </Link>
      </div>
      {(await searchParams).created ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Brand created.
        </p>
      ) : null}
      {similar.length ? (
        <p role="alert" className="border border-warning/40 px-3 py-2 text-sm text-warning">
          Similar brand names exist: {similar.map((s) => s.name).join(", ")}. Check they are not
          duplicates.
        </p>
      ) : null}
      <AdminSection title="Details" id="details">
        <ActionForm action={updateBrandAction} aria-label="Brand details">
          <BrandFields brand={brand} />
        </ActionForm>
      </AdminSection>
      <AdminSection title="Logo" id="logo">
        {brand.logoImageKey ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded file
          <img
            src={`/media/${brand.logoImageKey}`}
            alt={`${brand.name} logo`}
            className="h-20 w-fit border bg-muted object-contain p-2"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No logo. The public page shows a neutral monogram.
          </p>
        )}
        <ActionForm action={uploadBrandLogoAction} aria-label="Upload logo">
          <input type="hidden" name="id" value={brand.id} />
          <label htmlFor="logo-file" className="text-[13px] font-medium">
            Logo file (JPEG, PNG or WebP, max 5 MB; SVG is not accepted)
          </label>
          <input
            id="logo-file"
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            className="text-sm"
          />
          <SubmitButton variant="secondary">Upload logo</SubmitButton>
        </ActionForm>
      </AdminSection>
    </>
  );
}
