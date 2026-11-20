import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/lib/db";
import { PostgresRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { db, truncateAll } from "./helpers";

beforeAll(truncateAll);
afterAll(closeDb);

describe("rate limiter pruning", () => {
  it("prunes relative to its own clock and never drops the window it is counting", async () => {
    const past = new Date("2020-01-01T00:00:30Z");
    const key = rateLimitKey("prune-test", "x");
    const random = vi.spyOn(Math, "random").mockReturnValue(0); // prune on every call
    try {
      const limiter = new PostgresRateLimiter(db(), () => past);
      await limiter.consume(key, 2, 60);
      await limiter.consume(key, 2, 60);
      expect((await limiter.consume(key, 2, 60)).allowed).toBe(false);
      // A row more than a day older than the limiter's clock is removed; the current one stays.
      await db().execute(
        sql`INSERT INTO rate_limits (key, window_start, count) VALUES ('old', '2019-12-30T00:00:00Z', 1)`,
      );
      expect((await limiter.consume(key, 2, 60)).allowed).toBe(false);
      const rows = await db().execute<{ key: string }>(
        sql`SELECT key FROM rate_limits ORDER BY key`,
      );
      expect(rows.map((r) => r.key)).toEqual([key]);
    } finally {
      random.mockRestore();
    }
  });
});
