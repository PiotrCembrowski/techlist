import { inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AdminSection,
  CheckboxField,
  FieldGrid,
  SelectField,
  TextField,
  type Option,
} from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { specificationGroups } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guard";
import { listCanonicalUnits } from "@/lib/units";
import { uuidSchema } from "@/lib/validation";
import { getAdminOptions } from "@/modules/admin/queries";
import { getCategoryAncestors } from "@/modules/categories/service";
import {
  getEffectiveDefinitions,
  type EffectiveDefinition,
} from "@/modules/specifications/service";
import {
  createDefinitionAction,
  createGroupAction,
  updateCategoryAction,
  updateDefinitionAction,
} from "../actions";
import { CategoryFields } from "../category-form";

export const metadata = { title: "Edit category" };

const TYPES: Option[] = [
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "enum",
  "multi_select",
].map((t) => ({ value: t, label: t.replace("_", " ") }));
const DIRECTIONS: Option[] = [
  { value: "none", label: "No direction" },
  { value: "higher_is_better", label: "Higher is better" },
  { value: "lower_is_better", label: "Lower is better" },
];
const UNITS: Option[] = listCanonicalUnits().map((u) => ({ value: u, label: u }));

function DefinitionFields({
  d,
  groups,
  prefix,
}: {
  d?: EffectiveDefinition;
  groups: Option[];
  prefix: string;
}) {
  const r = (d?.validationRules ?? {}) as {
    min?: number;
    max?: number;
    step?: number;
    maxLength?: number;
    options?: string[];
  };
  return (
    <>
      <FieldGrid cols={4}>
        {!d ? (
          <TextField
            idPrefix={prefix}
            name="key"
            label="Key"
            required
            hint="snake_case, unique in the category tree"
          />
        ) : null}
        <TextField idPrefix={prefix} name="name" label="Label" defaultValue={d?.name} required />
        <SelectField
          idPrefix={prefix}
          name="groupId"
          label="Group"
          options={groups}
          defaultValue={d?.groupId}
          emptyLabel="— none —"
        />
        <SelectField
          idPrefix={prefix}
          name="dataType"
          label="Type"
          options={TYPES}
          defaultValue={d?.dataType ?? "text"}
          hint={d ? "Locked once values exist" : undefined}
        />
        <SelectField
          idPrefix={prefix}
          name="canonicalUnit"
          label="Unit"
          options={UNITS}
          defaultValue={d?.canonicalUnit}
          emptyLabel="— none —"
          hint="Numbers only"
        />
        <SelectField
          idPrefix={prefix}
          name="comparisonDirection"
          label="Comparison"
          options={DIRECTIONS}
          defaultValue={d?.comparisonDirection ?? "none"}
        />
        <TextField
          idPrefix={prefix}
          name="displayOrder"
          label="Order"
          type="number"
          defaultValue={d?.displayOrder ?? 0}
        />
        <TextField idPrefix={prefix} name="min" label="Min" defaultValue={r.min} />
        <TextField idPrefix={prefix} name="max" label="Max" defaultValue={r.max} />
        <TextField idPrefix={prefix} name="step" label="Step" defaultValue={r.step} />
        <TextField
          idPrefix={prefix}
          name="maxLength"
          label="Max length (text)"
          defaultValue={r.maxLength}
        />
        <TextField
          idPrefix={prefix}
          name="options"
          label="Options (enum)"
          defaultValue={r.options?.join(", ")}
          hint="Comma-separated"
        />
      </FieldGrid>
      <div className="flex flex-wrap gap-x-6">
        <CheckboxField name="isFilterable" label="Filterable" defaultChecked={d?.isFilterable} />
        <CheckboxField
          name="isComparable"
          label="Comparable"
          defaultChecked={d?.isComparable ?? true}
        />
        <CheckboxField name="isRequired" label="Core (required)" defaultChecked={d?.isRequired} />
        <CheckboxField
          name="hidden"
          label="Hidden from the public site"
          defaultChecked={d ? !d.isPublic : false}
        />
      </div>
    </>
  );
}

export default async function EditCategory({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const chain = await getCategoryAncestors(ctx.db, id);
  const category = chain[chain.length - 1];
  if (!category) notFound();
  const [defs, options, groupRows] = await Promise.all([
    getEffectiveDefinitions(ctx.db, id),
    getAdminOptions(ctx.db),
    ctx.db
      .select()
      .from(specificationGroups)
      .where(
        inArray(
          specificationGroups.categoryId,
          chain.map((c) => c.id),
        ),
      ),
  ]);
  const groups: Option[] = groupRows.map((g) => ({
    value: g.id,
    label: `${g.name}${g.categoryId !== id ? " (inherited)" : ""}`,
  }));
  const own = defs.filter((d) => d.categoryId === id);
  const inherited = defs.filter((d) => d.categoryId !== id);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/categories" className="text-sm text-primary">
          ← Categories
        </Link>
        <h1 className="text-4xl">{category.name}</h1>
        <p className="text-sm text-muted-foreground">{chain.map((c) => c.name).join(" › ")}</p>
      </div>
      {(await searchParams).created ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Category created. Add specification groups and definitions below.
        </p>
      ) : null}
      <AdminSection title="Details" id="details">
        <ActionForm action={updateCategoryAction} aria-label="Category details">
          <CategoryFields category={category} parents={options.categories} />
        </ActionForm>
      </AdminSection>

      <AdminSection title="Specification groups" id="groups">
        <ul className="flex flex-wrap gap-2 text-sm">
          {groupRows.map((g) => (
            <li key={g.id} className="border px-2 py-1">
              {g.name}{" "}
              <span className="text-muted-foreground">
                ({g.key}
                {g.categoryId !== id ? ", inherited" : ""})
              </span>
            </li>
          ))}
        </ul>
        <ActionForm action={createGroupAction} aria-label="Add group">
          <input type="hidden" name="categoryId" value={id} />
          <FieldGrid cols={3}>
            <TextField idPrefix="grp" name="key" label="Key" required hint="snake_case" />
            <TextField idPrefix="grp" name="name" label="Name" required />
            <TextField
              idPrefix="grp"
              name="displayOrder"
              label="Order"
              type="number"
              defaultValue={0}
            />
          </FieldGrid>
          <SubmitButton variant="secondary">Add group</SubmitButton>
        </ActionForm>
      </AdminSection>

      <AdminSection title="Specifications" id="definitions">
        {inherited.length ? (
          <p className="text-sm text-muted-foreground">
            Inherited from parent categories: {inherited.map((d) => d.name).join(", ")}. Edit them
            on the parent.
          </p>
        ) : null}
        {own.map((d) => (
          <ActionForm
            key={d.id}
            action={updateDefinitionAction}
            aria-label={`Specification ${d.name}`}
            className="border p-4"
          >
            <input type="hidden" name="id" value={d.id} />
            <h3 className="text-lg">
              {d.name}{" "}
              <span className="font-sans text-sm font-normal text-muted-foreground">({d.key})</span>
            </h3>
            <DefinitionFields d={d} groups={groups} prefix={d.id} />
            <SubmitButton variant="secondary">Save specification</SubmitButton>
          </ActionForm>
        ))}
        <ActionForm
          action={createDefinitionAction}
          aria-label="Add specification"
          className="border border-dashed p-4"
        >
          <input type="hidden" name="categoryId" value={id} />
          <h3 className="text-lg">Add specification</h3>
          <DefinitionFields groups={groups} prefix="new-def" />
          <SubmitButton variant="secondary">Add specification</SubmitButton>
        </ActionForm>
      </AdminSection>
    </>
  );
}
