import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/** Behind an interface so a different store can be swapped in without touching callers (SPEC §3). */
export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/**
 * Fixed-window counter in the `rate_limits` table (no Redis). One atomic upsert per call.
 * Old windows are pruned opportunistically.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly db: DbOrTx,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowMs = this.now().getTime();
    const windowStart = new Date(Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000);
    const [row] = await this.db.execute<{ count: number }>(sql`
      INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart.toISOString()}::timestamptz, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
      RETURNING count`);
    if (Math.random() < 0.01) {
      await this.db.execute(
        sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`,
      );
    }
    const count = Number(row?.count ?? 1);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: new Date(windowStart.getTime() + windowSeconds * 1000),
    };
  }
}

/**
 * Rate-limit keys never contain raw IPs or emails: parts are hashed. The window is short-lived and
 * rows are pruned after a day.
 */
export function rateLimitKey(scope: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("base64url").slice(0, 32);
  return `${scope}:${digest}`;
}

/** Best-effort client address from proxy headers (used only as hashed rate-limit input). */
export function clientAddress(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
