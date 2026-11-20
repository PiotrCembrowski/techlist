import {
  CheckboxField,
  FieldGrid,
  SelectField,
  TextArea,
  TextField,
  type Option,
} from "@/components/admin/fields";
import { SubmitButton } from "@/components/admin/form";
import type { Category } from "@/modules/categories/service";

export function CategoryFields({ category, parents }: { category?: Category; parents: Option[] }) {
  return (
    <>
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <FieldGrid>
        <TextField name="name" label="Name" defaultValue={category?.name} required />
        <TextField
          name="slug"
          label="URL slug"
          defaultValue={category?.slug}
          hint={category ? "Changing it redirects the old URL" : "Derived from the name if empty"}
        />
        <SelectField
          name="parentId"
          label="Parent"
          options={parents.filter((p) => p.value !== category?.id)}
          defaultValue={category?.parentId}
          emptyLabel="— top level —"
          hint="Children inherit the parent's specifications"
        />
        <TextField
          name="icon"
          label="Icon"
          defaultValue={category?.icon}
          hint="Lucide icon name, e.g. laptop"
        />
        <TextField
          name="sortOrder"
          label="Sort order"
          type="number"
          defaultValue={category?.sortOrder ?? 0}
        />
        <TextField name="seoTitle" label="SEO title" defaultValue={category?.seoTitle} />
      </FieldGrid>
      <TextArea name="description" label="Introduction" defaultValue={category?.description} />
      <TextField
        name="seoDescription"
        label="SEO description"
        defaultValue={category?.seoDescription}
      />
      <CheckboxField
        name="inactive"
        label="Inactive (hidden from the public site)"
        defaultChecked={category ? !category.isActive : false}
      />
      <SubmitButton>{category ? "Save category" : "Create category"}</SubmitButton>
    </>
  );
}
