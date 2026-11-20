"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import type { ActionState } from "@/lib/admin/action";

/** The only unauthenticated admin action. Rate-limited per IP + email inside authorize(). */
export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await signIn("credentials", {
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      redirectTo: "/admin",
    });
    return { ok: "Signed in" };
  } catch (e) {
    if (e instanceof AuthError) {
      const code = (e as AuthError & { code?: string }).code;
      return {
        error:
          code === "rate_limited"
            ? "Too many sign-in attempts. Try again in 15 minutes."
            : "Email or password is incorrect, or the account is inactive.",
        at: Date.now(),
      };
    }
    throw e; // includes the success redirect
  }
}
