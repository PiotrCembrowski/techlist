"use server";

import { cookies } from "next/headers";
import { getEnv } from "@/config/env";
import { MARKET_COOKIE } from "@/lib/market";
import { marketSchema } from "@/lib/validation";

/** Sets the market cookie (ISO country code or ALL). No geo-detection (SPEC §6). */
export async function setMarketAction(formData: FormData): Promise<void> {
  const parsed = marketSchema.safeParse(formData.get("market"));
  if (!parsed.success) return;
  (await cookies()).set(MARKET_COOKIE, parsed.data, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: getEnv().SITE_URL.startsWith("https://"),
  });
}
