import { sql } from "drizzle-orm";
import { customType, timestamp } from "drizzle-orm/pg-core";

/** created_at / updated_at; updated_at is maintained by the `sb_set_updated_at` trigger. */
export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** Reused CHECK expressions (kept as SQL so DB-level and Zod-level rules match). */
export const SLUG_CHECK = (col: unknown) => sql`${col} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`;
export const COUNTRY_CHECK = (col: unknown) => sql`${col} ~ '^[A-Z]{2}$'`;
export const CURRENCY_CHECK = (col: unknown) => sql`${col} ~ '^[A-Z]{3}$'`;
