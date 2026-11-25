import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import type { QuotaRule } from "./types";

export class ProviderQuotaExceededError extends Error {
  constructor(
    readonly provider: string,
    readonly bucket: string,
    readonly limit: number,
    /** When the window resets (the next call may succeed then). */
    readonly resetsAt: Date,
  ) {
    super(`${provider}: ${bucket} quota of ${limit} is used up until ${resetsAt.toISOString()}`);
    this.name = "ProviderQuotaExceededError";
  }
}

/** Start of the fixed window containing `now` (UTC; daily windows start at 00:00 UTC). */
export function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Reserves `units` in every rule's current window BEFORE a provider call, all or nothing. Each
 * reservation is one statement that only succeeds while used + units ≤ limit, so concurrent
 * workers can never overshoot. A failed reservation rolls back the others and throws
 * ProviderQuotaExceededError; the call must not be made. Reserved units are not refunded when
 * the call later fails (the provider usually counts it too).
 */
export async function reserveQuota(
  db: DbOrTx,
  provider: string,
  rules: readonly QuotaRule[],
  opts: { units?: number; now?: Date } = {},
): Promise<void> {
  if (rules.length === 0) return;
  const units = opts.units ?? 1;
  const now = opts.now ?? new Date();
  await db.transaction(async (tx) => {
    for (const rule of rules) {
      const start = windowStart(now, rule.windowSeconds);
      const rows = await tx.execute<{ used: number }>(sql`
        INSERT INTO provider_quota_usage (provider, bucket, window_start, window_seconds, used, limit_value)
        SELECT ${provider}, ${rule.bucket}, ${start.toISOString()}::timestamptz, ${rule.windowSeconds}, ${units}, ${rule.limit}
        WHERE ${units}::int <= ${rule.limit}::int
        ON CONFLICT (provider, bucket, window_start) DO UPDATE
          SET used = provider_quota_usage.used + EXCLUDED.used,
              limit_value = EXCLUDED.limit_value
          WHERE provider_quota_usage.used + EXCLUDED.used <= EXCLUDED.limit_value
        RETURNING used`);
      if (rows.length === 0) {
        throw new ProviderQuotaExceededError(
          provider,
          rule.bucket,
          rule.limit,
          new Date(start.getTime() + rule.windowSeconds * 1000),
        );
      }
    }
  });
}

export interface QuotaStatus {
  bucket: string;
  limit: number;
  used: number;
  remaining: number;
  windowStart: Date;
  resetsAt: Date;
}

/** Current usage for each rule (for the admin provider page and pre-flight checks). */
export async function getQuotaStatus(
  db: DbOrTx,
  provider: string,
  rules: readonly QuotaRule[],
  now: Date = new Date(),
): Promise<QuotaStatus[]> {
  const out: QuotaStatus[] = [];
  for (const rule of rules) {
    const start = windowStart(now, rule.windowSeconds);
    const [row] = await db.execute<{ used: number }>(sql`
      SELECT used FROM provider_quota_usage
      WHERE provider = ${provider} AND bucket = ${rule.bucket} AND window_start = ${start.toISOString()}::timestamptz`);
    const used = Number(row?.used ?? 0);
    out.push({
      bucket: rule.bucket,
      limit: rule.limit,
      used,
      remaining: Math.max(0, rule.limit - used),
      windowStart: start,
      resetsAt: new Date(start.getTime() + rule.windowSeconds * 1000),
    });
  }
  return out;
}

/** Deletes ledger rows older than `keepDays` (they only matter for their own window). */
export async function pruneQuotaUsage(db: DbOrTx, keepDays = 90): Promise<number> {
  const rows = await db.execute(sql`
    DELETE FROM provider_quota_usage WHERE window_start < now() - make_interval(days => ${keepDays})
    RETURNING 1`);
  return rows.length;
}
