import type { Env } from "@/config/env";
import { registerAdapter, unregisterAdapter } from "../core/registry";
import { fixtureAdapter } from "./fixture";

/**
 * Registers the adapters that may run with this configuration. Real provider adapters (Open
 * Icecat, Wikidata, UPCitemdb, eBay) are added here in their stages, once each provider's
 * current API documentation has been checked. Idempotent; called by the admin pages and the
 * worker before they look adapters up.
 */
export function ensureAdaptersRegistered(env: Env) {
  if (fixtureAdapter.missingConfig(env).length === 0) registerAdapter(fixtureAdapter);
  else unregisterAdapter("fixture");
}
