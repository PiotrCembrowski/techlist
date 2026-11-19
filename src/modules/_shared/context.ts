import type { DbOrTx } from "@/lib/db";

/** Every mutating service takes a context: the DB handle and the acting admin (null = system/CLI). */
export interface ServiceContext {
  db: DbOrTx;
  actorId: string | null;
}

export type Tx = Parameters<Parameters<DbOrTx["transaction"]>[0]>[0];

/** Runs `fn` in a transaction (a savepoint if `ctx.db` is already a transaction). */
export function inTransaction<T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return ctx.db.transaction(fn);
}

export const MAX_PAGE_SIZE = 48;
export const MAX_LIST_LIMIT = 200;

export function clampLimit(
  limit: number | undefined,
  fallback: number,
  max = MAX_LIST_LIMIT,
): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(1, Math.trunc(limit)), max);
}
