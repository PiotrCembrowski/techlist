import "server-only";
import { cookies } from "next/headers";
import { MARKET_COOKIE, parseMarket } from "./index";

export async function getSelectedMarket(): Promise<string> {
  return parseMarket((await cookies()).get(MARKET_COOKIE)?.value);
}
