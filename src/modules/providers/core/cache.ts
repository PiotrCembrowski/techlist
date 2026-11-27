import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Cache key for a request: method, URL with credentials already removed (the caller passes the
 * redacted URL) and body. Two requests that differ only in credentials share a cache entry.
 */
export function requestKey(method: string, redactedUrl: string, body?: string | null): string {
  return sha256(`${method.toUpperCase()} ${redactedUrl}\n${body ?? ""}`);
}

export interface CachedResponse {
  status: number;
  contentType: string | null;
  body: string;
  fetchedAt: Date;
}

export async function getCachedResponse(
  db: DbOrTx,
  provider: string,
  key: string,
  now: Date = new Date(),
): Promise<CachedResponse | null> {
  const [row] = await db.execute<{
    http_status: number;
    content_type: string | null;
    body: string;
    fetched_at: string;
  }>(sql`
    SELECT http_status, content_type, body, fetched_at::text FROM provider_response_cache
    WHERE provider = ${provider} AND request_key = ${key} AND expires_at > ${now.toISOString()}::timestamptz`);
  if (!row) return null;
  return {
    status: Number(row.http_status),
    contentType: row.content_type,
    body: row.body,
    fetchedAt: new Date(row.fetched_at),
  };
}

export async function putCachedResponse(
  db: DbOrTx,
  entry: {
    provider: string;
    key: string;
    redactedUrl: string;
    status: number;
    contentType: string | null;
    body: string;
    ttlSeconds: number;
    now?: Date;
  },
): Promise<void> {
  const now = entry.now ?? new Date();
  const expires = new Date(now.getTime() + entry.ttlSeconds * 1000);
  await db.execute(sql`
    INSERT INTO provider_response_cache (provider, request_key, request_url, http_status, content_type, body, body_hash, fetched_at, expires_at)
    VALUES (${entry.provider}, ${entry.key}, ${entry.redactedUrl}, ${entry.status}, ${entry.contentType}, ${entry.body},
            ${sha256(entry.body)}, ${now.toISOString()}::timestamptz, ${expires.toISOString()}::timestamptz)
    ON CONFLICT (provider, request_key) DO UPDATE SET
      request_url = EXCLUDED.request_url, http_status = EXCLUDED.http_status, content_type = EXCLUDED.content_type,
      body = EXCLUDED.body, body_hash = EXCLUDED.body_hash, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`);
}

/** Removes expired entries; run by the worker. */
export async function purgeExpiredResponses(db: DbOrTx, now: Date = new Date()): Promise<number> {
  const rows = await db.execute(sql`
    DELETE FROM provider_response_cache WHERE expires_at <= ${now.toISOString()}::timestamptz RETURNING 1`);
  return rows.length;
}
