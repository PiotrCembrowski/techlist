import type { Env } from "@/config/env";
import type { DbOrTx } from "@/lib/db";
import { ProviderHttpClient, type HttpClientOptions } from "./http";
import type { ProviderAdapter, ProviderKey } from "./types";

/**
 * Which env settings each provider needs before it can run (adapters use this in missingConfig).
 * Names only — values are never returned or logged.
 */
export function missingProviderConfig(provider: ProviderKey, env: Env): string[] {
  switch (provider) {
    case "icecat":
      // An API token identifies the account on its own; otherwise the user name is needed.
      return env.ICECAT_USERNAME || env.ICECAT_API_TOKEN ? [] : ["ICECAT_USERNAME"];
    case "wikidata":
      return env.WIKIDATA_USER_AGENT ? [] : ["WIKIDATA_USER_AGENT"];
    case "upcitemdb":
      return env.UPCITEMDB_ENABLED ? [] : ["UPCITEMDB_ENABLED=true"];
    case "fixture":
      return env.FIXTURE_PROVIDER && env.ENABLE_DEMO_DATA
        ? []
        : ["FIXTURE_PROVIDER=true (demo mode only)"];
    case "ebay":
      return [
        ...(env.EBAY_ENABLED ? [] : ["EBAY_ENABLED=true"]),
        ...(env.EBAY_CLIENT_ID ? [] : ["EBAY_CLIENT_ID"]),
        ...(env.EBAY_CLIENT_SECRET ? [] : ["EBAY_CLIENT_SECRET"]),
      ];
  }
}

/** User-Agent for provider requests: the operator's Wikimedia-compliant one if set. */
export function providerUserAgent(env: Env): string {
  return env.WIKIDATA_USER_AGENT ?? `Specbase-import/1.0 (+${env.SITE_URL})`;
}

/** The HTTP client an adapter must use: its hosts, quotas and spacing, plus the shared policy. */
export function httpClientFor(
  adapter: ProviderAdapter,
  env: Env,
  db: DbOrTx,
  overrides: Partial<HttpClientOptions> & { dailyCap?: number | null } = {},
): ProviderHttpClient {
  const { dailyCap, ...rest } = overrides;
  return new ProviderHttpClient({
    provider: adapter.key,
    db,
    allowedHosts: adapter.allowedHosts,
    // The admin's daily cap is one more ledger rule, on top of the provider's own limits.
    quotas: [
      ...adapter.quotas,
      ...(dailyCap ? [{ bucket: "daily_cap", limit: dailyCap, windowSeconds: 86_400 }] : []),
    ],
    minIntervalMs: adapter.minIntervalMs,
    secretParams: adapter.secretParams,
    userAgent: providerUserAgent(env),
    ...rest,
  });
}
