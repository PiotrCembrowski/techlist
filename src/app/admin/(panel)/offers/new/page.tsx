import Link from "next/link";
import { FieldGrid, SelectField } from "@/components/admin/fields";
import { ActionForm } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { uuidSchema } from "@/lib/validation";
import { getAdminOptions, getProductAdmin, searchProductsAdmin } from "@/modules/admin/queries";
import { createOfferAction } from "../actions";
import { OfferFields } from "../offer-form";

export const metadata = { title: "New offer" };

type SP = Promise<{ product?: string; retailer?: string; q?: string }>;

export default async function NewOffer({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireAdmin();
  const sp = await searchParams;
  const productId = uuidSchema.safeParse(sp.product).success ? sp.product! : null;
  const data = productId ? await getProductAdmin(ctx.db, productId) : null;

  if (!data) {
    const q = sp.q?.trim().slice(0, 100) ?? "";
    const matches = q ? await searchProductsAdmin(ctx.db, q) : [];
    const keep = sp.retailer && uuidSchema.safeParse(sp.retailer).success ? sp.retailer : null;
    return (
      <>
        <h1 className="text-4xl">New offer</h1>
        <form method="get" className="flex max-w-[640px] items-end gap-2" role="search">
          {keep ? <input type="hidden" name="retailer" value={keep} /> : null}
          <label
            className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium"
            htmlFor="offer-product-q"
          >
            Find the product
            <input
              id="offer-product-q"
              name="q"
              defaultValue={q}
              className="h-10 border bg-background px-2.5 text-sm"
            />
          </label>
          <button className="h-10 border px-4 font-heading font-semibold hover:bg-accent">
            Search
          </button>
        </form>
        {q ? (
          <ul className="flex flex-col gap-1 text-sm">
            {matches.length === 0 ? (
              <li className="text-muted-foreground">No products match “{q}”.</li>
            ) : null}
            {matches.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/admin/offers/new?product=${m.id}${keep ? `&retailer=${keep}` : ""}`}
                  className="text-primary"
                >
                  {m.brand_name} {m.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }

  const options = await getAdminOptions(ctx.db);
  const variants = data.variants.map((v) => ({ value: v.id, label: v.variantName }));
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/admin/products/${data.product.id}`} className="text-sm text-primary">
          ← {data.brand.name} {data.product.name}
        </Link>
        <h1 className="text-4xl">New offer</h1>
      </div>
      <ActionForm action={createOfferAction} aria-label="New offer" className="max-w-[960px]">
        <input type="hidden" name="productId" value={data.product.id} />
        <FieldGrid>
          <SelectField
            name="retailerId"
            label="Retailer"
            options={options.retailers}
            defaultValue={sp.retailer}
            emptyLabel="Choose a retailer"
            required
          />
        </FieldGrid>
        <OfferFields variants={variants} sources={options.sources} />
      </ActionForm>
    </>
  );
}
