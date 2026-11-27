"use server";

import { redirect } from "next/navigation";
import { getEnv } from "@/config/env";
import { adminAction, bool, int, list, req, str } from "@/lib/admin/action";
import { PostgresRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { InvalidStateError, ValidationError } from "@/modules/_shared/errors";
import {
  deleteMapping,
  saveMapping,
  testProviderConnection,
  updateProviderConfig,
} from "@/modules/import-center/service";
import type { RecordPreview } from "@/modules/import-jobs/preview";
import { ensureProviderSource } from "@/modules/import-jobs/sources";
import {
  cancelJob,
  enqueueProviderJob,
  getProviderJob,
  retryFailedItems,
} from "@/modules/import-jobs/service";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import { getAdapter } from "@/modules/providers/core/registry";
import { isProviderKey, setProviderEnabled } from "@/modules/providers/core/settings";
import type { ProviderKey } from "@/modules/providers/core/types";

function provider(fd: FormData): ProviderKey {
  const p = req(fd, "provider");
  if (!isProviderKey(p)) throw new ValidationError("Unknown provider");
  ensureAdaptersRegistered(getEnv());
  return p;
}

const optionalInt = (fd: FormData, name: string) => (str(fd, name) ? int(fd, name, NaN) : null);

export const toggleProviderAction = adminAction(
  async ({ ctx }, fd) => {
    const p = provider(fd);
    const enabled = req(fd, "enabled") === "true";
    await setProviderEnabled(ctx, p, enabled, getEnv());
    if (!enabled) return "Provider switched off";
    // The source row its data is attributed to; an admin confirms its licence on the Sources page.
    const source = await ensureProviderSource(ctx, getAdapter(p)!);
    return source.usagePermitted
      ? "Provider switched on"
      : "Provider switched on. Confirm its licence on the Sources page before importing.";
  },
  { role: "owner" },
);

export const providerConfigAction = adminAction(
  async ({ ctx }, fd) => {
    await updateProviderConfig(ctx, provider(fd), {
      dailyCap: optionalInt(fd, "dailyCap"),
      syncEveryDays: optionalInt(fd, "syncEveryDays"),
    });
    return "Provider settings saved";
  },
  { role: "owner" },
);

export const testConnectionAction = adminAction(async ({ ctx }, fd) => {
  const h = await testProviderConnection(ctx, getEnv(), provider(fd));
  if (h.status !== "ok") throw new InvalidStateError(`Connection ${h.status}: ${h.message ?? ""}`);
  return `Connection ok${h.message ? ` (${h.message})` : ""}`;
});

/** Admin endpoint throttle: provider jobs cost quota, so queueing is rate limited per admin. */
async function throttle(ctx: {
  db: Parameters<typeof cancelJob>[0]["db"];
  actorId: string | null;
}) {
  const r = await new PostgresRateLimiter(ctx.db).consume(
    rateLimitKey("import-queue", ctx.actorId ?? "system"),
    30,
    3600,
  );
  if (!r.allowed) throw new InvalidStateError("Too many import jobs queued in the last hour");
}

export const queueJobAction = adminAction(async ({ ctx }, fd) => {
  await throttle(ctx);
  const mode = req(fd, "mode") as "search" | "gtin" | "ids";
  if (!["search", "gtin", "ids"].includes(mode))
    throw new ValidationError("Choose what to look up");
  const job = await enqueueProviderJob(ctx, getEnv(), {
    provider: provider(fd),
    query: {
      mode,
      text: mode === "search" ? (str(fd, "text") ?? "") : undefined,
      values: mode === "search" ? [] : list(fd, "values"),
      dryRun: req(fd, "run") !== "import",
      categoryId: str(fd, "categoryId") ?? undefined,
    },
    maxItems: optionalInt(fd, "maxItems") ?? undefined,
  });
  redirect(`/admin/import-center/jobs/${job.id}?queued=1`);
});

export const cancelJobAction = adminAction(async ({ ctx }, fd) => {
  const job = await cancelJob(ctx, req(fd, "jobId"));
  return job.status === "cancelled"
    ? "Job cancelled"
    : "Cancel requested: the job stops after the current item";
});

export const retryJobAction = adminAction(async ({ ctx }, fd) => {
  const n = await retryFailedItems(ctx, req(fd, "jobId"));
  return `${n} failed item${n === 1 ? "" : "s"} queued again`;
});

/** From a finished preview job: import the selected (or all eligible) records. */
export const importFromPreviewAction = adminAction(async ({ ctx }, fd) => {
  await throttle(ctx);
  const data = await getProviderJob(ctx.db, req(fd, "jobId"));
  if (!data) throw new ValidationError("Unknown job");
  const previews = data.items.flatMap((i) =>
    ((i.result as { preview?: RecordPreview[] } | null)?.preview ?? []).map((p) => ({
      item: i,
      p,
    })),
  );
  const all = req(fd, "scope") === "all";
  const selected = new Set(fd.getAll("record").map(String));
  const chosen = previews.filter(
    ({ p }) => p.eligible && (all || selected.has(p.providerProductId)),
  );
  if (chosen.length === 0) throw new ValidationError("Select at least one eligible record");
  const p = data.job.provider as ProviderKey;
  ensureAdaptersRegistered(getEnv());
  const byId = getAdapter(p)?.capabilities.fetchById ?? false;
  const job = await enqueueProviderJob(ctx, getEnv(), {
    provider: p,
    query: byId
      ? {
          mode: "ids",
          values: chosen.map(({ p: r }) => r.providerProductId),
          fromJobId: data.job.id,
        }
      : {
          mode: "gtin",
          values: [...new Set(chosen.map(({ item }) => item.externalKey))],
          fromJobId: data.job.id,
        },
  });
  redirect(`/admin/import-center/jobs/${job.id}?queued=1`);
});

export const saveMappingAction = adminAction(async ({ ctx }, fd) => {
  // Feature targets come as "categoryId|definitionKey" from one select.
  const [targetCategory, targetKey] = (str(fd, "target") ?? "").split("|");
  await saveMapping(ctx, {
    provider: req(fd, "provider"),
    mappingType: req(fd, "mappingType") as "category" | "feature" | "brand",
    externalId: req(fd, "externalId"),
    byName: bool(fd, "byName"),
    externalName: str(fd, "externalName"),
    action: req(fd, "action") === "ignore" ? "ignore" : "map",
    categoryId: str(fd, "categoryId") ?? (targetCategory || null),
    targetCategoryId: str(fd, "targetCategoryId"),
    targetBrandId: str(fd, "targetBrandId"),
    definitionKey: str(fd, "definitionKey") ?? (targetKey || null),
    unit: str(fd, "unit"),
    notes: str(fd, "notes"),
  });
  return "Mapping saved";
});

export const deleteMappingAction = adminAction(async ({ ctx }, fd) => {
  await deleteMapping(ctx, req(fd, "id"));
  return "Mapping removed";
});
