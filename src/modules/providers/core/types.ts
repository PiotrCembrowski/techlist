import type { Env } from "@/config/env";
import type { DbOrTx } from "@/lib/db";
import type { ProviderHttpClient } from "./http";

/**
 * The provider adapter contract for the free-data import system (DECISIONS D78). Each adapter
 * declares what it can do, under which licence, and within which quotas; the shared HTTP client,
 * quota ledger and job runner enforce the rest. Adapters never write to the catalogue: they
 * return ProviderRecords, which the normalisation and matching code (Stage 3) turns into
 * reviewed changes.
 */

/** The free providers of the import brief. */
export const PROVIDER_KEYS = ["icecat", "wikidata", "upcitemdb", "ebay"] as const;
/**
 * `fixture` is an offline adapter with labelled synthetic records, available only in demo mode
 * with FIXTURE_PROVIDER=true (tests and trying out the Import Center). It never calls a network.
 */
export type ProviderKey = (typeof PROVIDER_KEYS)[number] | "fixture";

export interface ProviderCapabilities {
  /** Look up products by GTIN (EAN/UPC). */
  lookupByGtin: boolean;
  /** Free-text / brand + model search (discovery). */
  search: boolean;
  /** Fetch one record by the provider's own ID. */
  fetchById: boolean;
  /** Returns specification features. */
  specs: boolean;
  /** Returns image URLs. */
  images: boolean;
  /** Returns prices/offers. No free provider is used for offers (eBay is off by default). */
  offers: boolean;
}

/**
 * How the provider's data may be used. `store`: values may be saved and shown (with
 * attribution if required). `cross_check_only`: values may only confirm or question data from
 * another source; nothing from the provider is stored as a catalogue value.
 */
export interface ProviderLicence {
  name: string;
  url: string | null;
  usage: "store" | "cross_check_only";
  attributionRequired: boolean;
  /** Text to show where the data is displayed, if attribution is required. */
  attribution: string | null;
  /** Licence of images, which can differ per image (e.g. Wikimedia Commons). */
  imageLicence: "per_image" | "provider" | "none";
  /** Set until the licence terms were checked against the provider's current documentation. */
  unverified: boolean;
}

/** A limit the quota ledger enforces before each call. */
export interface QuotaRule {
  /** e.g. `requests`, `searches`. */
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export interface ProviderFeature {
  /** Provider's feature ID (Icecat feature ID, Wikidata property ID, …). */
  externalId: string;
  name: string;
  value: string;
  unit: string | null;
  /** Provider's group/category of the feature, for reports. */
  group?: string | null;
}

export interface ProviderImage {
  url: string;
  width: number | null;
  height: number | null;
  author: string | null;
  licence: string | null;
  licenceUrl: string | null;
}

/** One product as a provider describes it. Values are exactly what the provider returned. */
export interface ProviderRecord {
  provider: ProviderKey;
  providerProductId: string;
  /** Human-readable page for the record at the provider, if any. */
  url: string | null;
  brand: string | null;
  name: string | null;
  modelNumber: string | null;
  mpn: string | null;
  /** As returned (not yet normalised to GTIN-14). */
  gtins: string[];
  categoryExternalId: string | null;
  categoryName: string | null;
  /** Product family / series as the provider names it. */
  family?: string | null;
  /**
   * Purchasable-configuration attributes the provider states explicitly (never parsed out of a
   * product name). Storage and memory come from mapped specifications instead.
   */
  variant?: { colour?: string | null; region?: string | null; revision?: string | null };
  releaseDate: string | null;
  description: string | null;
  features: ProviderFeature[];
  images: ProviderImage[];
  /** Provider's quality/verification marker, if any. */
  quality: string | null;
  retrievedAt: Date;
  /** sha256 of the provider payload this record was built from (for change detection). */
  payloadHash: string;
}

export interface ProviderSearchHit {
  providerProductId: string;
  brand: string | null;
  name: string | null;
  modelNumber: string | null;
  gtins: string[];
}

export interface ProviderHealth {
  status: "ok" | "degraded" | "error" | "not_configured";
  message: string | null;
  checkedAt: Date;
}

export interface ProviderContext {
  db: DbOrTx;
  http: ProviderHttpClient;
}

export interface ProviderAdapter {
  readonly key: ProviderKey;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  readonly licence: ProviderLicence;
  /** Enforced by the quota ledger before every HTTP request. */
  readonly quotas: readonly QuotaRule[];
  /** API hosts this adapter may call; the HTTP client refuses any other host (SSRF guard). */
  readonly allowedHosts: readonly string[];
  /** Minimum spacing between requests in this process, in milliseconds. */
  readonly minIntervalMs: number;
  /** Query parameters that identify the account (redacted from logs and cache keys). */
  readonly secretParams?: readonly string[];
  /** HTTP requests one call costs (shown before a search is run); default 1 each. */
  readonly requestCost?: { lookupByGtin?: number; search?: number; fetchById?: number };
  /** How long raw responses are cached (seconds); also lets an import reuse a preview's calls. */
  readonly cacheTtlSeconds?: number;
  /** Confidence (0–1) of a record from this provider, e.g. higher for editor-checked records. */
  recordConfidence?(record: ProviderRecord): number;
  /** Which env variables are missing for this adapter to run (empty = configured). */
  missingConfig(env: Env): string[];
  healthCheck(ctx: ProviderContext): Promise<ProviderHealth>;
  lookupByGtin?(gtin14: string, ctx: ProviderContext): Promise<ProviderRecord[]>;
  search?(query: string, ctx: ProviderContext): Promise<ProviderSearchHit[]>;
  fetchById?(id: string, ctx: ProviderContext): Promise<ProviderRecord | null>;
}
