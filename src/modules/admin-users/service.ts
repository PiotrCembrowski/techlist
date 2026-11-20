import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { adminUsers } from "@/db/schema";
import {
  burnVerifyTime,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from "@/lib/auth/password";
import type { DbOrTx } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import {
  InvalidStateError,
  NotFoundError,
  parseOrThrow,
  rethrowDbError,
} from "@/modules/_shared/errors";

export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminRole = AdminUser["role"];
/** Never hand password hashes to callers. */
export type SafeAdminUser = Omit<AdminUser, "passwordHash">;

const strip = ({ passwordHash: _p, ...rest }: AdminUser): SafeAdminUser => {
  void _p;
  return rest;
};

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200)
  .refine((p) => !/^(.)\1+$/.test(p), "Password is too simple");

export const adminUserInputSchema = z.object({
  email: z
    .email()
    .trim()
    .transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
  role: z.enum(["owner", "editor"]).default("editor"),
});

/** Used by `pnpm admin:create` (actor null) and by owners in the admin UI. No default passwords exist. */
export async function createAdminUser(
  ctx: ServiceContext,
  input: z.input<typeof adminUserInputSchema>,
): Promise<SafeAdminUser> {
  const data = parseOrThrow(adminUserInputSchema, input, "Invalid admin user");
  const passwordHash = await hashPassword(data.password);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [row] = await tx
        .insert(adminUsers)
        .values({ email: data.email, name: data.name, role: data.role, passwordHash })
        .returning();
      const safe = strip(row!);
      await recordAudit(tx, {
        actorId: ctx.actorId,
        entityType: "admin_user",
        entityId: safe.id,
        action: "create",
        next: safe,
      });
      return safe;
    });
  } catch (e) {
    rethrowDbError(e);
  }
}

/** Returns the user only for a correct password on an active account; constant-ish time otherwise. */
export async function verifyAdminCredentials(
  db: DbOrTx,
  email: string,
  password: string,
): Promise<SafeAdminUser | null> {
  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email.trim().toLowerCase()))
    .limit(1);
  if (!user) {
    await burnVerifyTime(password);
    return null;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok || !user.isActive) return null;
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  return strip(user);
}

export async function getActiveAdmin(db: DbOrTx, id: string): Promise<SafeAdminUser | null> {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
  return user && user.isActive ? strip(user) : null;
}

export async function listAdminUsers(db: DbOrTx): Promise<SafeAdminUser[]> {
  return (await db.select().from(adminUsers).orderBy(asc(adminUsers.email)).limit(200)).map(strip);
}

/** Deactivation takes effect on the user's next request: every admin request re-checks is_active. */
export async function setAdminActive(
  ctx: ServiceContext,
  id: string,
  isActive: boolean,
): Promise<SafeAdminUser> {
  if (ctx.actorId === id && !isActive)
    throw new InvalidStateError("You cannot deactivate your own account");
  return inTransaction(ctx, async (tx) => {
    const [before] = await tx.select().from(adminUsers).where(eq(adminUsers.id, id)).for("update");
    if (!before) throw new NotFoundError("Admin user", id);
    const [row] = await tx
      .update(adminUsers)
      .set({ isActive })
      .where(eq(adminUsers.id, id))
      .returning();
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "admin_user",
      entityId: id,
      action: isActive ? "activate" : "deactivate",
      previous: strip(before),
      next: strip(row!),
    });
    return strip(row!);
  });
}
