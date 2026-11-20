import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getActiveAdmin, type SafeAdminUser } from "@/modules/admin-users/service";
import type { ServiceContext } from "@/modules/_shared/context";
import { auth } from "./index";

export interface AdminSession {
  user: SafeAdminUser;
  ctx: ServiceContext;
}

/**
 * Server-side authorization for every admin page, action and route handler (SPEC §9): a valid
 * session AND an active user in the database (deactivation is immediate). Owner-only operations
 * pass `{ role: "owner" }`.
 */
export async function requireAdmin(opts: { role?: "owner" } = {}): Promise<AdminSession> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/admin/login");
  const db = getDb();
  const user = await getActiveAdmin(db, id);
  if (!user) redirect("/admin/login?reason=inactive");
  if (opts.role === "owner" && user.role !== "owner") redirect("/admin?error=forbidden");
  return { user, ctx: { db, actorId: user.id } };
}
