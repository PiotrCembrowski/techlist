import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireAdmin, type AdminSession } from "@/lib/auth/guard";
import { ServiceError, ValidationError } from "@/modules/_shared/errors";

export type ActionState =
  | {
      ok?: string;
      error?: string;
      fields?: Record<string, string>;
      /** Changes on every result so the form can announce repeated identical messages. */
      at?: number;
    }
  | undefined;

/**
 * Wraps an admin Server Action. Authorization runs FIRST, server-side, on every call (SPEC §9);
 * the handler only runs for an active admin with the required role. Service errors become form
 * messages; redirects and other framework signals pass through.
 */
export function adminAction(
  handler: (session: AdminSession, fd: FormData) => Promise<string | void>,
  opts: { role?: "owner" } = {},
) {
  return async function action(_prev: ActionState, fd: FormData): Promise<ActionState> {
    const session = await requireAdmin(opts);
    try {
      const message = await handler(session, fd);
      revalidatePath("/", "layout");
      return { ok: message ?? "Saved", at: Date.now() };
    } catch (e) {
      unstable_rethrow(e);
      if (e instanceof ServiceError) {
        const fields =
          e instanceof ValidationError && e.issues.length
            ? Object.fromEntries(e.issues.filter((i) => i.path).map((i) => [i.path, i.message]))
            : undefined;
        return { error: e.message, fields, at: Date.now() };
      }
      console.error(
        JSON.stringify({
          level: "error",
          msg: "admin action failed",
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      return { error: "Something went wrong. Nothing was saved.", at: Date.now() };
    }
  };
}

// ─── FormData helpers (all values still go through the services' Zod schemas) ─────────

export function str(fd: FormData, name: string): string | null {
  const v = fd.get(name);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function req(fd: FormData, name: string): string {
  return str(fd, name) ?? "";
}

export function bool(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true" || v === "1";
}

export function int(fd: FormData, name: string, fallback = 0): number {
  const v = str(fd, name);
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) ? n : fallback;
}

/** Comma- or newline-separated list. */
export function list(fd: FormData, name: string): string[] {
  return (str(fd, name) ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function file(fd: FormData, name: string): File | null {
  const v = fd.get(name);
  return v instanceof File && v.size > 0 ? v : null;
}
