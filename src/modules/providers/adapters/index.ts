import type { Env } from "@/config/env";
import { registerAdapter, unregisterAdapter } from "../core/registry";
import { fixtureAdapter } from "./fixture";
import { createIcecatAdapter } from "./icecat";
import { createWikidataAdapter } from "./wikidata";

/**
 * Registers the adapters that may run with this configuration. Real provider adapters are added
 * here in their stages, once each provider's current API documentation has been checked (Open
 * Icecat: Stage 4; Wikidata + Commons: Stage 5; UPCitemdb, eBay: not yet). Idempotent; called by
 * the admin pages and the worker before they look adapters up.
 */
export function ensureAdaptersRegistered(env: Env) {
  // Registered even when not configured, so the admin can show what is missing.
  registerAdapter(createIcecatAdapter(env));
  registerAdapter(createWikidataAdapter());
  if (fixtureAdapter.missingConfig(env).length === 0) registerAdapter(fixtureAdapter);
  else unregisterAdapter("fixture");
}
