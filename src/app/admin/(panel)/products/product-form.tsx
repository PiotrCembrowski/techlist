import {
  CheckboxField,
  FieldGrid,
  SelectField,
  TextArea,
  TextField,
  type Option,
} from "@/components/admin/fields";
import { SubmitButton } from "@/components/admin/form";
import type { Product } from "@/modules/products/service";

const STATUS: Option[] = [
  { value: "unknown", label: "Unknown" },
  { value: "announced", label: "Announced" },
  { value: "active", label: "Available" },
  { value: "discontinued", label: "Discontinued" },
];

/** Shared fields for creating and editing a product (no publication controls here). */
export function ProductFields({
  product,
  brands,
  categories,
}: {
  product?: Product;
  brands: Option[];
  categories: Option[];
}) {
  return (
    <>
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <FieldGrid>
        <SelectField
          name="brandId"
          label="Brand"
          options={brands}
          defaultValue={product?.brandId}
          emptyLabel="Choose a brand"
          required
        />
        <SelectField
          name="categoryId"
          label="Category"
          options={categories}
          defaultValue={product?.categoryId}
          emptyLabel="Choose a category"
          required
          hint="Specifications come from this category and its parents"
        />
        <TextField
          name="name"
          label="Product name"
          defaultValue={product?.name}
          required
          hint="Without the brand, e.g. “Aera 7 Pro”"
        />
        <TextField
          name="slug"
          label="URL slug"
          defaultValue={product?.slug}
          hint={
            product ? "Changing it redirects the old URL" : "Leave empty to derive from the name"
          }
        />
        <TextField
          name="modelNumber"
          label="Model number"
          defaultValue={product?.modelNumber}
          hint="Unique per brand"
        />
        <TextField
          name="manufacturerPartNumber"
          label="Manufacturer part number (MPN)"
          defaultValue={product?.manufacturerPartNumber}
        />
        <TextField name="modelName" label="Model name" defaultValue={product?.modelName} />
        <TextField
          name="aliases"
          label="Aliases"
          defaultValue={product?.aliases.join(", ")}
          hint="Comma-separated alternative names"
        />
      </FieldGrid>
      <FieldGrid cols={4}>
        <SelectField
          name="productStatus"
          label="Product status"
          options={STATUS}
          defaultValue={product?.productStatus ?? "unknown"}
        />
        <TextField
          name="announcedDate"
          label="Announced"
          type="date"
          defaultValue={product?.announcedDate}
          errorKey="announcedDate"
        />
        <TextField
          name="releaseDate"
          label="Released"
          type="date"
          defaultValue={product?.releaseDate}
        />
        <TextField
          name="discontinuedDate"
          label="Discontinued"
          type="date"
          defaultValue={product?.discontinuedDate}
        />
      </FieldGrid>
      <TextField
        name="shortDescription"
        label="Short summary"
        defaultValue={product?.shortDescription}
        hint="One or two factual sentences (max 300 characters)"
      />
      <TextArea
        name="description"
        label="Description"
        defaultValue={product?.description}
        rows={5}
      />
      <FieldGrid>
        <TextField
          name="seoTitle"
          label="SEO title"
          defaultValue={product?.seoTitle}
          hint="Optional; defaults to brand + name"
        />
        <TextField
          name="seoDescription"
          label="SEO description"
          defaultValue={product?.seoDescription}
        />
      </FieldGrid>
      <div className="flex flex-wrap gap-6">
        <CheckboxField
          name="isFeatured"
          label="Featured on the homepage"
          defaultChecked={product?.isFeatured}
        />
        <CheckboxField
          name="isDemo"
          label="Demonstration record"
          defaultChecked={product?.isDemo}
          hint="Labelled “Demo” and never indexed"
        />
      </div>
      <SubmitButton>{product ? "Save product" : "Create draft"}</SubmitButton>
    </>
  );
}
