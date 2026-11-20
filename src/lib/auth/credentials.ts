import { z } from "zod";
import type { DbOrTx } from "@/lib/db";
import { clientAddress, PostgresRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { verifyAdminCredentials, type SafeAdminUser } from "@/modules/admin-users/service";

/** SPEC §13: 5 login attempts per 15 minutes per IP + email. */
export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export type CredentialsResult =
  { kind: "ok"; user: SafeAdminUser } | { kind: "invalid" } | { kind: "rate_limited" };

/**
 * The credential check behind the Auth.js provider (kept free of Auth.js so it is testable).
 * Every attempt — right or wrong — counts against the IP + email budget before the password is
 * checked, so the limit cannot be probed for valid accounts.
 */
export async function checkCredentials(
  db: DbOrTx,
  raw: unknown,
  headers: Headers,
  now?: () => Date,
): Promise<CredentialsResult> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return { kind: "invalid" };
  const email = parsed.data.email.toLowerCase();
  const limit = await new PostgresRateLimiter(db, now).consume(
    rateLimitKey("login", clientAddress(headers), email),
    LOGIN_LIMIT,
    LOGIN_WINDOW_SECONDS,
  );
  if (!limit.allowed) return { kind: "rate_limited" };
  const user = await verifyAdminCredentials(db, email, parsed.data.password);
  return user ? { kind: "ok", user } : { kind: "invalid" };
}
