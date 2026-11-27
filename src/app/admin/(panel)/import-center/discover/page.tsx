import {
  AdminSection,
  AdminTable,
  FieldGrid,
  SelectField,
  TextArea,
  TextField,
} from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { getEnv } from "@/config/env";
import { requireAdmin } from "@/lib/auth/guard";
import { TARGET_CATEGORIES } from "@/modules/import-core/catalog-config";
import { providerOverview } from "@/modules/import-center/service";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import { queueJobAction } from "../actions";
import { ImportCenterHeader } from "../tabs";

export const metadata = { title: "Discover products" };

export default async function Discover() {
  const { ctx } = await requireAdmin();
  const env = getEnv();
  ensureAdaptersRegistered(env);
  const [providers, cats] = await Promise.all([
    providerOverview(ctx.db, env),
    ctx.db.query.categories.findMany({ columns: { id: true, slug: true, name: true } }),
  ]);
  const runnable = providers.filter(
    (p) => p.adapter && p.missing.length === 0 && p.settings?.enabled && p.source?.usagePermitted,
  );
  const categoryOptions = TARGET_CATEGORIES.flatMap((c) => {
    const cat = cats.find((x) => x.slug === c.slug);
    return cat ? [{ value: cat.id, label: cat.name }] : [];
  });
  return (
    <>
      <ImportCenterHeader current="/admin/import-center/discover" title="Discover" />
      <AdminTable
        label="Request costs"
        head={["Provider", "Search", "GTIN lookup", "Record by ID", "Quota left today"]}
      >
        {providers
          .filter((p) => p.adapter)
          .map((p) => (
            <tr key={p.key}>
              <td>{p.label}</td>
              <td>
                {p.adapter!.capabilities.search
                  ? `${p.adapter!.requestCost?.search ?? 1} request(s)`
                  : "—"}
              </td>
              <td>
                {p.adapter!.capabilities.lookupByGtin
                  ? `${p.adapter!.requestCost?.lookupByGtin ?? 1} per GTIN`
                  : "—"}
              </td>
              <td>
                {p.adapter!.capabilities.fetchById
                  ? `${p.adapter!.requestCost?.fetchById ?? 1} per record`
                  : "—"}
              </td>
              <td className="text-xs">
                {p.quota.length
                  ? p.quota.map((q) => (
                      <span key={q.bucket} className="block">
                        {q.bucket.replace("_", " ")}: {q.remaining} of {q.limit}
                      </span>
                    ))
                  : "no limit recorded"}
              </td>
            </tr>
          ))}
      </AdminTable>
      {runnable.length === 0 ? (
        <p role="status" className="border border-warning/40 px-3 py-2 text-sm">
          No provider is ready. On the Providers tab a provider must have an adapter, be configured,
          be switched on, and have its licence confirmed on the Sources page.
        </p>
      ) : (
        <AdminSection title="Find products" id="find">
          <p className="text-sm text-muted-foreground">
            “Preview” fetches and matches the records without changing the catalogue; you then
            choose what to import. Each lookup uses quota, shown above. Previewed responses are
            cached, so importing them right after costs no extra requests.
          </p>
          <ActionForm action={queueJobAction} aria-label="Find products">
            <FieldGrid cols={3}>
              <SelectField
                name="provider"
                label="Provider"
                required
                options={runnable.map((p) => ({ value: p.key, label: p.label }))}
              />
              <SelectField
                name="mode"
                label="Look up by"
                options={[
                  { value: "search", label: "Keyword, brand or model" },
                  { value: "gtin", label: "GTIN / EAN / UPC list" },
                  { value: "ids", label: "Provider product IDs" },
                ]}
              />
              <SelectField
                name="categoryId"
                label="For category"
                emptyLabel="Any"
                options={categoryOptions}
              />
            </FieldGrid>
            <TextField
              name="text"
              label="Search text"
              hint="For keyword search, e.g. brand and model name"
            />
            <TextArea
              name="values"
              label="GTINs or provider IDs"
              rows={4}
              hint="One per line (or comma-separated). Ignored for keyword search."
            />
            <FieldGrid cols={3}>
              <TextField
                name="maxItems"
                label="Item cap for this job"
                type="number"
                defaultValue={Math.min(50, env.IMPORT_JOB_MAX_ITEMS)}
                hint={`At most ${env.IMPORT_JOB_MAX_ITEMS}`}
              />
              <SelectField
                name="run"
                label="Run"
                options={[
                  { value: "preview", label: "Preview first (recommended)" },
                  { value: "import", label: "Import directly (still needs review)" },
                ]}
              />
            </FieldGrid>
            <SubmitButton>Queue</SubmitButton>
          </ActionForm>
        </AdminSection>
      )}
    </>
  );
}
