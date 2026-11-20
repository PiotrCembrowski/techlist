"use server";

import { headers } from "next/headers";
import type { ActionState } from "@/lib/admin/action";
import { getDb } from "@/lib/db";
import { clientAddress } from "@/lib/rate-limit";
import { ServiceError, ValidationError } from "@/modules/_shared/errors";
import { submitCorrection } from "@/modules/corrections/service";

/**
 * Public Server Action (no login): validated and rate limited in the service; Server Actions'
 * origin check covers CSRF. A filled honeypot is answered like a success.
 */
export async function suggestCorrectionAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const text = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : "";
  };
  try {
    const result = await submitCorrection(
      getDb(),
      {
        productId: text("productId"),
        key: text("key"),
        value: text("value"),
        sourceUrl: text("sourceUrl"),
        email: text("email"),
        honeypot: text("website"),
      },
      clientAddress(await headers()),
    );
    if (!result.ok)
      return {
        error: "You have sent several corrections recently. Please try again in an hour.",
        at: Date.now(),
      };
    return {
      ok: "Thank you. An editor will check your correction against the source before anything changes.",
      at: Date.now(),
    };
  } catch (e) {
    if (e instanceof ValidationError) {
      return {
        error: e.message,
        fields: Object.fromEntries(e.issues.filter((i) => i.path).map((i) => [i.path, i.message])),
        at: Date.now(),
      };
    }
    if (e instanceof ServiceError) return { error: e.message, at: Date.now() };
    throw e;
  }
}
