import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminSection, CheckboxField, SelectField } from "@/components/admin/fields";
import { ActionForm, FieldError, SubmitButton } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { getUnit } from "@/lib/units";
import { uuidSchema } from "@/lib/validation";
import { getAdminOptions, getProductAdmin } from "@/modules/admin/queries";
import {
  getEffectiveDefinitions,
  getProductSpecifications,
  type EffectiveDefinition,
  type ProductSpecification,
} from "@/modules/specifications/service";
import { saveSpecificationsAction } from "../../actions";

export const metadata = { title: "Specifications" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ variant?: string }> };

const control =
  "h-10 w-full border bg-background px-2.5 text-sm aria-[invalid=true]:border-destructive";

function rawValue(v: ProductSpecification | undefined): string {
  if (!v) return "";
  if (v.valueBoolean !== null) return v.valueBoolean ? "yes" : "no";
  if (v.valueNumeric !== null) return String(Number(v.valueNumeric));
  return v.valueDate ?? v.valueText ?? "";
}

function SpecInput({
  d,
  value,
}: {
  d: EffectiveDefinition;
  value: ProductSpecification | undefined;
}) {
  const id = `spec-${d.key}`;
  const name = `spec.${d.key}`;
  const options = ((d.validationRules as { options?: string[] }).options ?? []) as string[];
  const unit = d.canonicalUnit ? (getUnit(d.canonicalUnit)?.display ?? d.canonicalUnit) : null;
  let input: React.ReactNode;
  if (d.dataType === "boolean") {
    input = (
      <select id={id} name={name} defaultValue={rawValue(value)} className={control}>
        <option value="">— no value —</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  } else if (d.dataType === "enum") {
    input = (
      <select id={id} name={name} defaultValue={rawValue(value)} className={control}>
        <option value="">— no value —</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (d.dataType === "multi_select") {
    input = (
      <fieldset id={id} className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="sr-only">{d.name}</legend>
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              name={name}
              value={o}
              defaultChecked={value?.valueJson?.includes(o)}
              className="size-4 accent-[var(--primary)]"
            />
            {o}
          </label>
        ))}
      </fieldset>
    );
  } else {
    input = (
      <input
        id={id}
        name={name}
        type={d.dataType === "date" ? "date" : "text"}
        inputMode={d.dataType === "integer" || d.dataType === "decimal" ? "decimal" : undefined}
        defaultValue={rawValue(value)}
        placeholder={unit ? `e.g. 12 ${unit === "″" ? "in" : unit}` : undefined}
        aria-describedby={`${id}-err`}
        className={control}
      />
    );
  }
  return (
    <div className="grid gap-1.5 border-b py-3 sm:grid-cols-[220px_minmax(0,1fr)_120px] sm:items-start sm:gap-4">
      <div className="flex flex-col">
        <label htmlFor={id} className="text-sm font-medium">
          {d.name}
        </label>
        {d.isRequired ? (
          <span className="text-xs text-muted-foreground">core specification</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        {input}
        {unit ? (
          <span className="text-xs text-muted-foreground">
            Stored in {unit}. Other units are converted (e.g. “1 TB”, “1390 g”).
          </span>
        ) : null}
        <FieldError name={`spec.${d.key}`} id={`${id}-err`} />
        {value ? <input type="hidden" name={`present.${d.key}`} value="1" /> : null}
      </div>
      <span className="text-xs text-muted-foreground">
        {value
          ? value.verificationStatus === "verified"
            ? "verified"
            : value.origin === "ai_extracted"
              ? "AI-extracted, unverified"
              : "unverified"
          : "no value"}
      </span>
    </div>
  );
}

export default async function ProductSpecs({ params, searchParams }: Props) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getProductAdmin(ctx.db, id);
  if (!data) notFound();
  const variantParam = (await searchParams).variant;
  const variant = data.variants.find((v) => v.id === variantParam) ?? null;
  const [defs, resolved, options] = await Promise.all([
    getEffectiveDefinitions(ctx.db, data.product.categoryId),
    getProductSpecifications(ctx.db, id, variant?.id ?? null),
    getAdminOptions(ctx.db),
  ]);
  // Only values stored at this scope are editable here (product level or this variant's overrides).
  const own = new Map(
    resolved
      .filter((r) => (variant ? r.value.variantId === variant.id : r.value.variantId === null))
      .map((r) => [r.definition.key, r.value]),
  );
  const groups = [...new Set(defs.map((d) => d.groupName ?? "Other"))];

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/admin/products/${id}`} className="text-sm text-primary">
          ← {data.brand.name} {data.product.name}
        </Link>
        <h1 className="text-4xl">Specifications</h1>
      </div>
      <nav aria-label="Scope" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Editing</span>
        <Link
          href={`/admin/products/${id}/specs`}
          aria-current={!variant ? "page" : undefined}
          className={`border px-3 py-1.5 ${!variant ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
        >
          Product (all variants)
        </Link>
        {data.variants.map((v) => (
          <Link
            key={v.id}
            href={`/admin/products/${id}/specs?variant=${v.id}`}
            aria-current={variant?.id === v.id ? "page" : undefined}
            className={`border px-3 py-1.5 ${variant?.id === v.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {v.variantName}
          </Link>
        ))}
      </nav>
      {variant ? (
        <p className="text-sm text-muted-foreground">
          Only fill in values that differ for this variant; empty fields fall back to the product
          value.
        </p>
      ) : null}
      <ActionForm
        action={saveSpecificationsAction}
        aria-label="Specifications"
        className="max-w-[960px]"
      >
        <input type="hidden" name="productId" value={id} />
        {variant ? <input type="hidden" name="variantId" value={variant.id} /> : null}
        {groups.map((g) => (
          <AdminSection key={g} title={g}>
            <div className="flex flex-col">
              {defs
                .filter((d) => (d.groupName ?? "Other") === g)
                .map((d) => (
                  <SpecInput key={d.id} d={d} value={own.get(d.key)} />
                ))}
            </div>
          </AdminSection>
        ))}
        <AdminSection title="Provenance">
          <SelectField
            name="sourceId"
            label="Source for the values you change"
            options={options.sources}
            emptyLabel="—"
          />
          <CheckboxField
            name="markVerified"
            label="I checked the changed values against this source (mark them verified)"
            hint="Leave unticked for unverified data. Verified values are never overwritten by unverified input; a review item is created instead."
          />
        </AdminSection>
        <SubmitButton>Save specifications</SubmitButton>
      </ActionForm>
    </>
  );
}
