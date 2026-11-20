import { CheckboxField, FieldGrid, TextArea, TextField } from "@/components/admin/fields";
import { SubmitButton } from "@/components/admin/form";
import type { Brand } from "@/modules/brands/service";

export function BrandFields({ brand }: { brand?: Brand }) {
  return (
    <>
      {brand ? <input type="hidden" name="id" value={brand.id} /> : null}
      <FieldGrid>
        <TextField name="name" label="Name" defaultValue={brand?.name} required />
        <TextField
          name="slug"
          label="URL slug"
          defaultValue={brand?.slug}
          hint={brand ? "Changing it redirects the old URL" : "Derived from the name if empty"}
        />
        <TextField
          name="officialWebsiteUrl"
          label="Official website (https)"
          defaultValue={brand?.officialWebsiteUrl}
        />
        <TextField
          name="countryOfOrigin"
          label="Country of origin"
          defaultValue={brand?.countryOfOrigin}
          hint="Two-letter code, e.g. NO"
        />
        <TextField
          name="aliases"
          label="Aliases"
          defaultValue={brand?.aliases.join(", ")}
          hint="Other spellings used in imports, comma-separated"
          className="sm:col-span-2"
        />
      </FieldGrid>
      <TextArea name="description" label="Overview" defaultValue={brand?.description} />
      <div className="flex flex-wrap gap-6">
        <CheckboxField
          name="inactive"
          label="Inactive (hidden from the public site)"
          defaultChecked={brand ? !brand.isActive : false}
        />
        <CheckboxField name="isDemo" label="Demonstration record" defaultChecked={brand?.isDemo} />
      </div>
      <SubmitButton>{brand ? "Save brand" : "Create brand"}</SubmitButton>
    </>
  );
}
