import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AdminSection,
  AdminTable,
  CheckboxField,
  FieldGrid,
  SelectField,
  StatusPill,
  TextField,
} from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { formatDate } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { getAdminOptions, getProductAdmin, searchProductsAdmin } from "@/modules/admin/queries";
import { productHref } from "@/modules/catalog/service";
import {
  addLinkAction,
  addRelationshipAction,
  addSourceRecordAction,
  createVariantAction,
  imageOpAction,
  productStatusAction,
  removeLinkAction,
  removeRelationshipAction,
  removeSourceRecordAction,
  updateProductAction,
  updateVariantAction,
  uploadImageAction,
  verifyProductAction,
} from "../actions";
import { ProductFields } from "../product-form";

export const metadata = { title: "Edit product" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; rq?: string }>;
};

const VERIFICATION = [
  { value: "draft", label: "Draft" },
  { value: "needs_review", label: "Needs review" },
  { value: "partially_verified", label: "Partially verified" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
];

export default async function EditProduct({ params, searchParams }: Props) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const sp = await searchParams;
  const [data, options] = await Promise.all([getProductAdmin(ctx.db, id), getAdminOptions(ctx.db)]);
  if (!data) notFound();
  const { product, brand, variants, images, relationships, sourceRecords, links, specCount } = data;
  const relQuery = sp.rq?.trim().slice(0, 80) ?? "";
  const candidates = relQuery.length >= 2 ? await searchProductsAdmin(ctx.db, relQuery, id) : [];
  const variantOptions = variants.map((v) => ({ value: v.id, label: v.variantName }));
  const publicUrl = productHref(brand.slug, product.slug);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/admin/products" className="text-sm text-primary">
            ← Products
          </Link>
          <h1 className="text-4xl">
            {brand.name} {product.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill value={product.publicationStatus} />
            <StatusPill value={product.verificationStatus} />
            {product.isDemo ? <StatusPill value="demo" /> : null}
            {product.publicationStatus === "published" ? (
              <Link href={publicUrl} className="text-primary">
                View public page
              </Link>
            ) : (
              <span className="text-muted-foreground">Not public</span>
            )}
            <Link href={`/admin/audit?entity=product&id=${product.id}`} className="text-primary">
              History
            </Link>
          </div>
        </div>
      </div>
      {sp.created ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Draft created. Add variants, specifications and a source, then publish.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <AdminSection title="Details" id="details">
          <ActionForm action={updateProductAction} aria-label="Product details">
            <ProductFields
              product={product}
              brands={options.brands}
              categories={options.categories}
            />
          </ActionForm>
        </AdminSection>

        <div className="flex flex-col gap-6">
          <AdminSection title="Publication" id="publication">
            <p className="text-sm text-muted-foreground">
              Only published products are public. “Delete” means archive; drafts can be deleted
              permanently.
            </p>
            <div className="flex flex-wrap gap-2">
              {product.publicationStatus !== "published" ? (
                <ActionForm action={productStatusAction} aria-label="Publish">
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="op" value="publish" />
                  <SubmitButton>Publish</SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={productStatusAction} aria-label="Unpublish">
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="op" value="unpublish" />
                  <SubmitButton variant="secondary">Unpublish</SubmitButton>
                </ActionForm>
              )}
              {product.publicationStatus !== "archived" ? (
                <ActionForm
                  action={productStatusAction}
                  aria-label="Archive"
                  confirm="Archive this product? It will disappear from the public site."
                >
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="op" value="archive" />
                  <SubmitButton variant="danger">Archive</SubmitButton>
                </ActionForm>
              ) : null}
              {product.publicationStatus === "draft" ? (
                <ActionForm
                  action={productStatusAction}
                  aria-label="Delete draft"
                  confirm="Permanently delete this draft and everything attached to it?"
                >
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="op" value="delete" />
                  <input type="hidden" name="confirm" value="yes" />
                  <SubmitButton variant="danger">Delete draft</SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          </AdminSection>

          <AdminSection title="Verification" id="verification">
            <ActionForm action={verifyProductAction} aria-label="Verification">
              <input type="hidden" name="id" value={product.id} />
              <SelectField
                name="verificationStatus"
                label="Status"
                options={VERIFICATION}
                defaultValue={product.verificationStatus}
              />
              <p className="text-xs text-muted-foreground">
                Last verified: {formatDate(product.lastVerifiedAt) ?? "never"}. Only mark verified
                after checking values against a source.
              </p>
              <SubmitButton variant="secondary">Save verification</SubmitButton>
            </ActionForm>
          </AdminSection>

          <AdminSection title="Specifications" id="specs">
            <p className="text-sm">{specCount} values recorded.</p>
            <Link
              href={`/admin/products/${product.id}/specs`}
              className="w-fit border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Edit specifications
            </Link>
          </AdminSection>

          <AdminSection title="Offers" id="offers">
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/offers?product=${product.id}`}
                className="w-fit border px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                View offers
              </Link>
              <Link
                href={`/admin/offers/new?product=${product.id}`}
                className="w-fit border px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Add offer
              </Link>
            </div>
          </AdminSection>
        </div>
      </div>

      <AdminSection title="Variants" id="variants">
        <p className="text-sm text-muted-foreground">
          Each regional or configuration variant is its own record. The first variant becomes the
          default.
        </p>
        {variants.map((v) => (
          <ActionForm
            key={v.id}
            action={updateVariantAction}
            aria-label={`Variant ${v.variantName}`}
            className="border p-4"
          >
            <input type="hidden" name="id" value={v.id} />
            <FieldGrid cols={4}>
              <TextField
                idPrefix={v.id}
                name="variantName"
                label="Name"
                defaultValue={v.variantName}
                required
              />
              <TextField
                idPrefix={v.id}
                name="variantCode"
                label="Code"
                defaultValue={v.variantCode}
                hint="Used in ?variant="
              />
              <TextField
                idPrefix={v.id}
                name="regionCode"
                label="Region"
                defaultValue={v.regionCode}
                hint="e.g. EU, US; empty = global"
              />
              <TextField
                idPrefix={v.id}
                name="barcodeGtin"
                label="GTIN"
                defaultValue={v.barcodeGtin}
              />
              <TextField idPrefix={v.id} name="color" label="Colour" defaultValue={v.color} />
              <TextField
                idPrefix={v.id}
                name="memoryConfiguration"
                label="Memory"
                defaultValue={v.memoryConfiguration}
              />
              <TextField
                idPrefix={v.id}
                name="storageConfiguration"
                label="Storage"
                defaultValue={v.storageConfiguration}
              />
              <TextField
                idPrefix={v.id}
                name="manufacturerPartNumber"
                label="MPN"
                defaultValue={v.manufacturerPartNumber}
              />
            </FieldGrid>
            <div className="flex flex-wrap items-center gap-6">
              {v.isDefault ? (
                <StatusPill value="default variant" />
              ) : (
                <CheckboxField name="makeDefault" label="Make default" />
              )}
              <CheckboxField name="inactive" label="Inactive" defaultChecked={!v.isActive} />
              <SubmitButton variant="secondary">Save variant</SubmitButton>
            </div>
          </ActionForm>
        ))}
        <ActionForm
          action={createVariantAction}
          aria-label="Add variant"
          className="border border-dashed p-4"
        >
          <input type="hidden" name="productId" value={product.id} />
          <h3 className="text-lg">Add variant</h3>
          <FieldGrid cols={4}>
            <TextField
              idPrefix="new-variant"
              name="variantName"
              label="Name"
              required
              hint="e.g. 512 GB · EU"
            />
            <TextField
              idPrefix="new-variant"
              name="variantCode"
              label="Code"
              hint="Derived from the name if empty"
            />
            <TextField idPrefix="new-variant" name="regionCode" label="Region" />
            <TextField idPrefix="new-variant" name="barcodeGtin" label="GTIN" />
            <TextField idPrefix="new-variant" name="color" label="Colour" />
            <TextField idPrefix="new-variant" name="memoryConfiguration" label="Memory" />
            <TextField idPrefix="new-variant" name="storageConfiguration" label="Storage" />
            <TextField idPrefix="new-variant" name="manufacturerPartNumber" label="MPN" />
          </FieldGrid>
          <SubmitButton variant="secondary">Add variant</SubmitButton>
        </ActionForm>
      </AdminSection>

      <AdminSection title="Images" id="images">
        <p className="text-sm text-muted-foreground">
          Upload only images whose licence permits use. JPEG, PNG or WebP up to 5 MB. No hotlinking.
        </p>
        {images.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {images.map((img) => (
              <li key={img.id} className="flex flex-col gap-2 border p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of an uploaded file */}
                <img
                  src={`/media/${img.storageKey}`}
                  alt={img.altText}
                  className="aspect-square w-full bg-muted object-contain"
                />
                <span className="text-xs">{img.altText}</span>
                <span className="text-xs text-muted-foreground">
                  {img.licenseType}
                  {img.isPrimary ? " · primary" : ""}
                </span>
                <div className="flex gap-2">
                  {!img.isPrimary ? (
                    <ActionForm action={imageOpAction} aria-label="Make primary">
                      <input type="hidden" name="imageId" value={img.id} />
                      <input type="hidden" name="op" value="primary" />
                      <SubmitButton variant="secondary">Make primary</SubmitButton>
                    </ActionForm>
                  ) : null}
                  <ActionForm
                    action={imageOpAction}
                    aria-label="Delete image"
                    confirm="Delete this image?"
                  >
                    <input type="hidden" name="imageId" value={img.id} />
                    <input type="hidden" name="op" value="delete" />
                    <SubmitButton variant="danger">Delete</SubmitButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <ActionForm
          action={uploadImageAction}
          aria-label="Upload image"
          className="border border-dashed p-4"
        >
          <input type="hidden" name="productId" value={product.id} />
          <FieldGrid cols={3}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="image-file" className="text-[13px] font-medium">
                Image file <span className="text-destructive">*</span>
              </label>
              <input
                id="image-file"
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
                className="text-sm"
              />
            </div>
            <TextField idPrefix="img" name="altText" label="Alt text" required />
            <TextField
              idPrefix="img"
              name="licenseType"
              label="Licence"
              required
              hint="e.g. Press kit, permitted for editorial use"
            />
            <TextField idPrefix="img" name="attributionText" label="Attribution" />
            <SelectField
              idPrefix="img"
              name="sourceId"
              label="Source"
              options={options.sources}
              emptyLabel="—"
            />
            <SelectField
              idPrefix="img"
              name="variantId"
              label="Variant"
              options={variantOptions}
              emptyLabel="All variants"
            />
          </FieldGrid>
          <SubmitButton variant="secondary">Upload image</SubmitButton>
        </ActionForm>
      </AdminSection>

      <AdminSection title="Relationships" id="relationships">
        <p className="text-sm text-muted-foreground">
          Successions are stored once; the other product shows it as its predecessor automatically.
        </p>
        <AdminTable
          head={["Type", "Product", ""]}
          empty={relationships.length ? undefined : "No relationships yet."}
        >
          {relationships.map((r) => (
            <tr key={r.id}>
              <td className="capitalize">{r.label}</td>
              <td>
                <Link href={`/admin/products/${r.otherId}`} className="text-primary">
                  {r.otherName}
                </Link>
              </td>
              <td>
                <ActionForm
                  action={removeRelationshipAction}
                  aria-label="Remove relationship"
                  confirm="Remove this relationship?"
                >
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton variant="danger">Remove</SubmitButton>
                </ActionForm>
              </td>
            </tr>
          ))}
        </AdminTable>
        <form method="get" className="flex items-end gap-2" aria-label="Find a product to relate">
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            Find product
            <input
              name="rq"
              defaultValue={relQuery}
              className="h-10 w-64 border bg-background px-2.5 text-sm"
            />
          </label>
          <button type="submit" className="h-10 border px-3 text-sm hover:bg-accent">
            Search
          </button>
        </form>
        {candidates.length ? (
          <ActionForm action={addRelationshipAction} aria-label="Add relationship">
            <input type="hidden" name="productId" value={product.id} />
            <FieldGrid cols={3}>
              <SelectField
                idPrefix="rel"
                name="otherProductId"
                label="Product"
                options={candidates.map((c) => ({
                  value: c.id,
                  label: `${c.brand_name} ${c.name}`,
                }))}
                required
              />
              <SelectField
                idPrefix="rel"
                name="kind"
                label="This product's…"
                options={[
                  { value: "successor", label: "successor is the selected product" },
                  { value: "predecessor", label: "predecessor is the selected product" },
                  { value: "alternative", label: "alternative" },
                  { value: "competitor", label: "competitor" },
                  { value: "compatible_with", label: "compatible with" },
                  { value: "accessory_for", label: "accessory for" },
                  { value: "related", label: "related" },
                ]}
              />
              <SelectField
                idPrefix="rel"
                name="sourceId"
                label="Source"
                options={options.sources}
                emptyLabel="—"
              />
            </FieldGrid>
            <SubmitButton variant="secondary">Add relationship</SubmitButton>
          </ActionForm>
        ) : relQuery ? (
          <p className="text-sm text-muted-foreground">No products match “{relQuery}”.</p>
        ) : null}
      </AdminSection>

      <AdminSection title="Sources" id="sources">
        <p className="text-sm text-muted-foreground">
          Record where this product&rsquo;s data came from. Sources that don&rsquo;t permit use are
          refused.
        </p>
        <AdminTable
          head={["Source", "Type", "Variant", "Retrieved", ""]}
          empty={sourceRecords.length ? undefined : "No sources recorded."}
        >
          {sourceRecords.map((r) => (
            <tr key={r.id}>
              <td>
                {r.source_url ? (
                  <a
                    href={r.source_url}
                    className="text-primary"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {r.source_name}
                  </a>
                ) : (
                  r.source_name
                )}
              </td>
              <td>{r.source_type.replace(/_/g, " ")}</td>
              <td>{r.variant_name ?? "All"}</td>
              <td>{formatDate(r.retrieved_at) ?? "—"}</td>
              <td>
                <ActionForm
                  action={removeSourceRecordAction}
                  aria-label="Remove source record"
                  confirm="Remove this source record?"
                >
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton variant="danger">Remove</SubmitButton>
                </ActionForm>
              </td>
            </tr>
          ))}
        </AdminTable>
        <ActionForm
          action={addSourceRecordAction}
          aria-label="Add source record"
          className="border border-dashed p-4"
        >
          <input type="hidden" name="productId" value={product.id} />
          <FieldGrid cols={3}>
            <SelectField
              idPrefix="src"
              name="sourceId"
              label="Source"
              options={options.sources}
              emptyLabel="Choose a source"
              required
            />
            <SelectField
              idPrefix="src"
              name="variantId"
              label="Variant"
              options={variantOptions}
              emptyLabel="All variants"
            />
            <TextField idPrefix="src" name="retrievedAt" label="Retrieved" type="date" />
            <TextField idPrefix="src" name="sourceUrl" label="URL at the source" />
            <TextField
              idPrefix="src"
              name="sourceProductIdentifier"
              label="Identifier at the source"
            />
            <TextField idPrefix="src" name="notes" label="Notes" />
          </FieldGrid>
          <div className="flex items-center gap-4">
            <SubmitButton variant="secondary">Add source</SubmitButton>
            <Link href="/admin/sources/new" className="text-sm text-primary">
              New source…
            </Link>
          </div>
        </ActionForm>
      </AdminSection>

      <AdminSection title="Manufacturer links" id="links">
        <p className="text-sm text-muted-foreground">
          Shown publicly only when the link&rsquo;s source permits use.
        </p>
        <AdminTable
          head={["Type", "URL", "Source", ""]}
          empty={links.length ? undefined : "No links."}
        >
          {links.map((l) => (
            <tr key={l.id}>
              <td>{l.link_type.replace(/_/g, " ")}</td>
              <td className="max-w-[360px] truncate">{l.url}</td>
              <td>
                {l.source_name
                  ? `${l.source_name}${l.usage_permitted ? "" : " (not shown: use not permitted)"}`
                  : "— (not shown publicly)"}
              </td>
              <td>
                <ActionForm action={removeLinkAction} aria-label="Remove link">
                  <input type="hidden" name="id" value={l.id} />
                  <SubmitButton variant="danger">Remove</SubmitButton>
                </ActionForm>
              </td>
            </tr>
          ))}
        </AdminTable>
        <ActionForm
          action={addLinkAction}
          aria-label="Add link"
          className="border border-dashed p-4"
        >
          <input type="hidden" name="productId" value={product.id} />
          <FieldGrid cols={3}>
            <SelectField
              idPrefix="link"
              name="linkType"
              label="Type"
              options={["official", "support", "manual", "driver", "spec_sheet"].map((t) => ({
                value: t,
                label: t.replace("_", " "),
              }))}
            />
            <TextField idPrefix="link" name="url" label="URL (https)" required />
            <SelectField
              idPrefix="link"
              name="sourceId"
              label="Source"
              options={options.sources}
              emptyLabel="—"
            />
          </FieldGrid>
          <SubmitButton variant="secondary">Add link</SubmitButton>
        </ActionForm>
      </AdminSection>
    </>
  );
}
