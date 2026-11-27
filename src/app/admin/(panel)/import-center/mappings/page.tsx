import Link from "next/link";
import {
  AdminSection,
  AdminTable,
  CheckboxField,
  FieldGrid,
  SelectField,
  TextField,
} from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { getEnv } from "@/config/env";
import { requireAdmin } from "@/lib/auth/guard";
import { TARGET_CATEGORIES } from "@/modules/import-core/catalog-config";
import { unmappedFeatureReport } from "@/modules/import-core/reports";
import { listMappings, PROVIDER_LABELS, visibleProviders } from "@/modules/import-center/service";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import { isProviderKey } from "@/modules/providers/core/settings";
import { getEffectiveDefinitionsForCategories } from "@/modules/specifications/service";
import { deleteMappingAction, saveMappingAction } from "../actions";
import { ImportCenterHeader } from "../tabs";

export const metadata = { title: "Provider mappings" };

export default async function Mappings({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>;
}) {
  const { ctx } = await requireAdmin();
  ensureAdaptersRegistered(getEnv());
  const providers = visibleProviders();
  const sp = await searchParams;
  const provider =
    isProviderKey(sp.provider) && providers.includes(sp.provider) ? sp.provider : providers[0]!;
  const [mappings, unmapped, cats, brands] = await Promise.all([
    listMappings(ctx.db, provider),
    unmappedFeatureReport(ctx.db, provider, { limit: 300 }),
    ctx.db.query.categories.findMany({ columns: { id: true, slug: true, name: true } }),
    ctx.db.query.brands.findMany({ columns: { id: true, name: true } }),
  ]);
  const targets = cats.filter((c) => TARGET_CATEGORIES.some((t) => t.slug === c.slug));
  const defs = await getEffectiveDefinitionsForCategories(
    ctx.db,
    targets.map((c) => c.id),
  );
  const targetOptions = targets.flatMap((c) =>
    (defs.get(c.id) ?? []).map((d) => ({
      value: `${c.id}|${d.key}`,
      label: `${c.name} › ${d.name}${d.canonicalUnit ? ` (${d.canonicalUnit})` : ""}`,
    })),
  );
  const categoryOptions = cats.map((c) => ({ value: c.id, label: c.name }));
  const brandOptions = brands
    .map((b) => ({ value: b.id, label: b.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const hidden = (type: string) => (
    <>
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="mappingType" value={type} />
    </>
  );

  return (
    <>
      <ImportCenterHeader current="/admin/import-center/mappings" title="Mappings" />
      <nav aria-label="Provider" className="flex flex-wrap gap-2 text-sm">
        {providers.map((p) => (
          <Link
            key={p}
            href={`/admin/import-center/mappings?provider=${p}`}
            aria-current={p === provider ? "page" : undefined}
            className={
              p === provider ? "border px-3 py-1.5 font-medium" : "px-3 py-1.5 text-primary"
            }
          >
            {PROVIDER_LABELS[p]}
          </Link>
        ))}
      </nav>
      <p className="max-w-[780px] text-sm text-muted-foreground">
        Mappings decide which provider categories, brands and features become ours. Nothing is
        mapped automatically: records whose category or brand has no mapping are held back, and
        features without a mapping are kept raw and listed below. Only set a unit when the
        provider&apos;s documentation states it.
      </p>

      <AdminSection title={`Unmapped features (${unmapped.length})`} id="unmapped">
        <AdminTable
          label="Unmapped features"
          head={["Category", "Feature", "Example", "Products", "Map to"]}
          empty={unmapped.length ? undefined : "No unmapped features recorded for this provider."}
        >
          {unmapped.map((u) => {
            const cat = cats.find((c) => c.slug === u.categorySlug);
            return (
              <tr key={`${u.categorySlug}-${u.externalId}`}>
                <td>{u.categoryName}</td>
                <td>
                  {u.name}
                  <span className="block font-mono text-xs text-muted-foreground">
                    {u.externalId}
                  </span>
                </td>
                <td className="text-xs">
                  {u.exampleValue}
                  {u.exampleUnit ? ` ${u.exampleUnit}` : ""}
                </td>
                <td>{u.products}</td>
                <td>
                  <ActionForm
                    action={saveMappingAction}
                    aria-label={`Map ${u.name}`}
                    className="gap-2"
                  >
                    {hidden("feature")}
                    <input type="hidden" name="externalId" value={u.externalId} />
                    <input type="hidden" name="externalName" value={u.name} />
                    <input type="hidden" name="categoryId" value={cat?.id ?? ""} />
                    <SelectField
                      idPrefix={`u-${u.categorySlug}-${u.externalId}`}
                      name="target"
                      label="Specification"
                      emptyLabel="Choose…"
                      options={targetOptions.filter((o) => o.value.startsWith(`${cat?.id}|`))}
                    />
                    <div className="flex gap-2">
                      <SubmitButton variant="secondary">Map</SubmitButton>
                      <button
                        type="submit"
                        name="action"
                        value="ignore"
                        className="h-10 border px-3 text-sm hover:bg-accent"
                      >
                        Ignore
                      </button>
                    </div>
                  </ActionForm>
                </td>
              </tr>
            );
          })}
        </AdminTable>
      </AdminSection>

      <div className="grid gap-6 xl:grid-cols-3">
        <AdminSection title="Map a category" id="map-category">
          <ActionForm action={saveMappingAction} aria-label="Map a category">
            {hidden("category")}
            <TextField idPrefix="mc" name="externalId" label="Provider category ID" required />
            <TextField idPrefix="mc" name="externalName" label="Provider category name" />
            <SelectField
              idPrefix="mc"
              name="targetCategoryId"
              label="Our category"
              required
              options={categoryOptions}
            />
            <SubmitButton variant="secondary">Save category mapping</SubmitButton>
          </ActionForm>
        </AdminSection>
        <AdminSection title="Map a brand" id="map-brand">
          <ActionForm action={saveMappingAction} aria-label="Map a brand">
            {hidden("brand")}
            <TextField
              idPrefix="mb"
              name="externalId"
              label="Brand as the provider writes it"
              required
            />
            <SelectField
              idPrefix="mb"
              name="targetBrandId"
              label="Our brand"
              required
              options={brandOptions}
            />
            <SubmitButton variant="secondary">Save brand mapping</SubmitButton>
          </ActionForm>
        </AdminSection>
        <AdminSection title="Map a feature" id="map-feature">
          <ActionForm action={saveMappingAction} aria-label="Map a feature">
            {hidden("feature")}
            <TextField
              idPrefix="mf"
              name="externalId"
              label="Provider feature ID or name"
              required
            />
            <CheckboxField name="byName" label="Match by feature name instead of ID" />
            <SelectField
              idPrefix="mf"
              name="target"
              label="Specification"
              required
              emptyLabel="Choose…"
              options={targetOptions}
            />
            <FieldGrid cols={2}>
              <TextField
                idPrefix="mf"
                name="unit"
                label="Unit for bare numbers"
                hint="Only if documented"
              />
            </FieldGrid>
            <SubmitButton variant="secondary">Save feature mapping</SubmitButton>
          </ActionForm>
        </AdminSection>
      </div>

      <AdminSection title={`Mappings (${mappings.length})`} id="mappings">
        <AdminTable
          label="Mappings"
          head={["Type", "Provider value", "Scope", "Ours", "Unit", ""]}
          empty={mappings.length ? undefined : "No mappings for this provider yet."}
        >
          {mappings.map((m) => (
            <tr key={m.id}>
              <td>{m.mapping_type}</td>
              <td>
                <span className="font-mono text-xs">{m.external_id}</span>
                {m.external_name ? (
                  <span className="block text-xs text-muted-foreground">{m.external_name}</span>
                ) : null}
              </td>
              <td className="text-xs">{m.scope ?? "all"}</td>
              <td>{m.action === "ignore" ? <StatusIgnore /> : m.target}</td>
              <td className="text-xs">{m.unit ?? "—"}</td>
              <td>
                <ActionForm
                  action={deleteMappingAction}
                  aria-label={`Remove mapping ${m.external_id}`}
                >
                  <input type="hidden" name="id" value={m.id} />
                  <SubmitButton variant="danger">Remove</SubmitButton>
                </ActionForm>
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminSection>
    </>
  );
}

function StatusIgnore() {
  return <span className="text-muted-foreground">ignored</span>;
}
