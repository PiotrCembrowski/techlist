import Link from "next/link";
import { AdminTable, StatusPill, TextField } from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { getEnv } from "@/config/env";
import { requireAdmin } from "@/lib/auth/guard";
import { formatRelative } from "@/lib/format";
import { providerOverview } from "@/modules/import-center/service";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import { providerConfigAction, testConnectionAction, toggleProviderAction } from "./actions";
import { ImportCenterHeader } from "./tabs";

export const metadata = { title: "Import Center" };

export default async function ImportCenterProviders() {
  const { ctx, user } = await requireAdmin();
  const env = getEnv();
  ensureAdaptersRegistered(env);
  const providers = await providerOverview(ctx.db, env);
  const owner = user.role === "owner";
  return (
    <>
      <ImportCenterHeader current="/admin/import-center" title="Providers" />
      <p className="max-w-[780px] text-sm text-muted-foreground">
        Free product data sources. A provider runs only when it has an adapter, its settings are in
        the environment, it is switched on here, and its licence is confirmed on the{" "}
        <Link href="/admin/sources" className="text-primary underline">
          Sources
        </Link>{" "}
        page. Imports create records that need review; nothing is published automatically.
      </p>
      <AdminTable
        label="Providers"
        head={[
          "Provider",
          "Status",
          "Health",
          "Quota today",
          "Last sync",
          "Recent errors",
          "Actions",
        ]}
      >
        {providers.map((p) => {
          const state = !p.adapter
            ? "no adapter yet"
            : p.missing.length
              ? "not configured"
              : p.settings?.enabled
                ? p.source?.usagePermitted
                  ? "on"
                  : "on, licence not confirmed"
                : "off";
          return (
            <tr key={p.key}>
              <td>
                <span className="font-medium">{p.label}</span>
                {p.adapter?.licence.unverified ? (
                  <span className="block text-xs text-warning">Licence terms not yet verified</span>
                ) : null}
                {p.missing.length ? (
                  <span className="block font-mono text-xs text-muted-foreground">
                    Needs {p.missing.join(", ")}
                  </span>
                ) : null}
              </td>
              <td>
                <StatusPill value={state} />
              </td>
              <td className="text-xs">
                <StatusPill value={p.settings?.lastHealthStatus ?? "unknown"} />
                {p.settings?.lastHealthCheckedAt ? (
                  <span className="block text-muted-foreground">
                    {formatRelative(p.settings.lastHealthCheckedAt)}
                    {p.settings.lastHealthMessage ? ` · ${p.settings.lastHealthMessage}` : ""}
                  </span>
                ) : null}
              </td>
              <td className="text-xs whitespace-nowrap">
                {p.quota.length
                  ? p.quota.map((q) => (
                      <span key={q.bucket} className="block">
                        {q.bucket.replace("_", " ")}: {q.used} / {q.limit} ({q.remaining} left)
                      </span>
                    ))
                  : "—"}
              </td>
              <td className="text-xs whitespace-nowrap text-muted-foreground">
                {p.lastSuccessAt ? formatRelative(p.lastSuccessAt) : "never"}
              </td>
              <td className="max-w-[260px] text-xs">
                {p.recentErrors.length
                  ? p.recentErrors.map((e, i) => (
                      <Link
                        key={i}
                        href={`/admin/import-center/jobs/${e.jobId}`}
                        className="block truncate text-destructive"
                      >
                        {e.message}
                      </Link>
                    ))
                  : "—"}
              </td>
              <td>
                <div className="flex flex-col gap-2">
                  {p.adapter ? (
                    <ActionForm action={testConnectionAction} aria-label={`Test ${p.label}`}>
                      <input type="hidden" name="provider" value={p.key} />
                      <SubmitButton variant="secondary">Test connection</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {owner && p.adapter ? (
                    <ActionForm action={toggleProviderAction} aria-label={`Switch ${p.label}`}>
                      <input type="hidden" name="provider" value={p.key} />
                      <input
                        type="hidden"
                        name="enabled"
                        value={p.settings?.enabled ? "false" : "true"}
                      />
                      <SubmitButton variant={p.settings?.enabled ? "secondary" : undefined}>
                        {p.settings?.enabled ? "Switch off" : "Switch on"}
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                  {owner && p.adapter ? (
                    <ActionForm action={providerConfigAction} aria-label={`Caps for ${p.label}`}>
                      <input type="hidden" name="provider" value={p.key} />
                      <TextField
                        idPrefix={`cap-${p.key}`}
                        name="dailyCap"
                        label="Daily request cap"
                        type="number"
                        defaultValue={p.dailyCap}
                        hint="On top of the provider's own limits"
                      />
                      <TextField
                        idPrefix={`cap-${p.key}`}
                        name="syncEveryDays"
                        label="Re-sync every (days)"
                        type="number"
                        defaultValue={p.syncEveryDays}
                        hint="Empty = no scheduled sync"
                      />
                      <SubmitButton variant="secondary">Save caps</SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              </td>
            </tr>
          );
        })}
      </AdminTable>
    </>
  );
}
