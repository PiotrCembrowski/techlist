import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getEnv } from "@/config/env";
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
      // Relative to this limiter's clock, so pruning never removes the window being counted.
      const cutoff = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
      await this.db.execute(
        sql`DELETE FROM rate_limits WHERE window_start < ${cutoff}::timestamptz`,
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

/**
 * Client address for rate limiting (hashed, never stored raw). Each trusted proxy appends the
 * address it saw to X-Forwarded-For, so the real client is `hops` entries from the end; anything
 * before that was supplied by the client and cannot be trusted (taking the first entry would let
 * clients pick their own rate-limit bucket).
 */
export function clientAddress(
  headers: Headers,
  hops: number = getEnv().TRUSTED_PROXY_HOPS,
): string {
  if (hops <= 0) return "unknown";
  const parts = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length) return parts[Math.max(0, parts.length - hops)]!;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
