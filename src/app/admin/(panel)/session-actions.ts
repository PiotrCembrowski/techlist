"use server";

import { signOut } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth/guard";

export async function logoutAction(): Promise<void> {
  await requireAdmin();
  await signOut({ redirectTo: "/admin/login" });
}
