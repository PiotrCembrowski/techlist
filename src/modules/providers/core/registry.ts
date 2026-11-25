import type { ProviderAdapter, ProviderKey } from "./types";

/**
 * Registered provider adapters. Adapters are added in their own stages, each only after its API
 * details were checked against the provider's current documentation (Icecat: Stage 4, Wikidata:
 * Stage 5, UPCitemdb: Stage 6, eBay: Stage 7 after licence approval). Until then the provider is
 * listed in the admin as "no adapter yet" and cannot be enabled.
 */
const adapters = new Map<ProviderKey, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter) {
  adapters.set(adapter.key, adapter);
}

export function getAdapter(key: ProviderKey): ProviderAdapter | null {
  return adapters.get(key) ?? null;
}

export function listAdapters(): ProviderAdapter[] {
  return [...adapters.values()];
}

/** Tests only. */
export function unregisterAdapter(key: ProviderKey) {
  adapters.delete(key);
}
