import type { JobQuery } from "@/modules/import-jobs/service";

export function describeQuery(q: JobQuery): string {
  const what =
    q.mode === "search"
      ? `search “${q.text}”`
      : `${q.values.length} ${q.mode === "gtin" ? "GTIN" : "ID"}${q.values.length === 1 ? "" : "s"}`;
  return `${q.dryRun ? "Preview" : q.sync ? "Re-sync" : "Import"}: ${what}`;
}
