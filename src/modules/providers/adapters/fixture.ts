import { createHash } from "node:crypto";
import { gtinCheckDigit } from "@/lib/validation";
import { missingProviderConfig } from "../core/config";
import type {
  ProviderAdapter,
  ProviderFeature,
  ProviderRecord,
  ProviderSearchHit,
} from "../core/types";

/**
 * SYNTHETIC FIXTURE PROVIDER — not a real data source and not real provider output.
 *
 * Serves a handful of made-up products of the fictional demo brands, offline, so the Import
 * Center and the job worker can be tried and tested end to end without any API. Available only
 * in demo mode with FIXTURE_PROVIDER=true (env validation refuses it otherwise). GTINs use the
 * GS1 restricted-circulation prefix 2, which never identifies a real trade item.
 */

const g = (body12: string) => `${body12}${gtinCheckDigit(body12)}`;
const feat = (
  externalId: string,
  name: string,
  value: string,
  unit: string | null = null,
): ProviderFeature => ({
  externalId,
  name,
  value,
  unit,
});

type Base = Omit<ProviderRecord, "retrievedAt" | "payloadHash" | "provider">;

const RECORDS: Base[] = [
  {
    providerProductId: "FIX-1001",
    url: null,
    brand: "Novik",
    name: "Novik Lumen 5",
    modelNumber: "NK-L5",
    mpn: "NKL5-128-GR",
    gtins: [g("200000001001")],
    categoryExternalId: "fixture-phones",
    categoryName: "Fixture phones",
    releaseDate: "2026-05-12",
    description: "Synthetic fixture product for testing the import pipeline.",
    features: [
      feat("FIX-storage", "Storage", "128", "GB"),
      feat("FIX-ram", "RAM", "6", "GB"),
      feat("FIX-battery", "Battery", "4500", "mAh"),
      feat("FIX-screen", "Screen diagonal", "6.1", "in"),
      feat("FIX-os", "Operating system", "Fixture OS 2"),
      feat("FIX-colour-code", "Colour code", "GR-01"),
    ],
    images: [],
    quality: "SYNTHETIC",
    variant: { colour: "Graphite" },
  },
  {
    providerProductId: "FIX-1002",
    url: null,
    brand: "Novik",
    name: "Novik Lumen 5",
    modelNumber: "NK-L5",
    mpn: "NKL5-256-GR",
    gtins: [g("200000001002")],
    categoryExternalId: "fixture-phones",
    categoryName: "Fixture phones",
    releaseDate: "2026-05-12",
    description: "Synthetic fixture product for testing the import pipeline.",
    features: [
      feat("FIX-storage", "Storage", "256", "GB"),
      feat("FIX-ram", "RAM", "8", "GB"),
      feat("FIX-battery", "Battery", "4500", "mAh"),
      feat("FIX-screen", "Screen diagonal", "6.1", "in"),
      feat("FIX-os", "Operating system", "Fixture OS 2"),
    ],
    images: [],
    quality: "SYNTHETIC",
    variant: { colour: "Graphite" },
  },
  {
    providerProductId: "FIX-1003",
    url: null,
    brand: "Novik",
    name: "Novik Lumen 5 Mini",
    modelNumber: "NK-L5M",
    mpn: null,
    gtins: [g("200000001003")],
    categoryExternalId: "fixture-phones",
    categoryName: "Fixture phones",
    releaseDate: null,
    description: null,
    features: [
      feat("FIX-storage", "Storage", "128", "GB"),
      feat("FIX-battery", "Battery", "3900", "mAh"),
    ],
    images: [],
    quality: "SYNTHETIC",
  },
  {
    providerProductId: "FIX-2001",
    url: null,
    brand: "Unlisted Brand",
    name: "Unlisted Brand Phone X",
    modelNumber: "UB-X",
    mpn: null,
    gtins: [g("200000002001")],
    categoryExternalId: "fixture-phones",
    categoryName: "Fixture phones",
    releaseDate: null,
    description: null,
    features: [],
    images: [],
    quality: "SYNTHETIC",
  },
];

function materialize(base: Base): ProviderRecord {
  const payloadHash = createHash("sha256").update(JSON.stringify(base)).digest("hex");
  return { ...base, provider: "fixture", retrievedAt: new Date(), payloadHash };
}

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

export const fixtureAdapter: ProviderAdapter = {
  key: "fixture",
  displayName: "Synthetic fixture data (demo only)",
  capabilities: {
    lookupByGtin: true,
    search: true,
    fetchById: true,
    specs: true,
    images: false,
    offers: false,
  },
  licence: {
    name: "Synthetic test data",
    url: null,
    usage: "store",
    attributionRequired: true,
    attribution: "Synthetic fixture data — not real products",
    imageLicence: "none",
    unverified: false,
  },
  quotas: [],
  allowedHosts: [],
  minIntervalMs: 0,
  missingConfig: (env) => missingProviderConfig("fixture", env),
  async healthCheck() {
    return { status: "ok", message: "Offline synthetic data", checkedAt: new Date() };
  },
  async lookupByGtin(gtin14) {
    return RECORDS.filter((r) => r.gtins.some((x) => x.padStart(14, "0") === gtin14)).map(
      materialize,
    );
  },
  async search(query): Promise<ProviderSearchHit[]> {
    const q = words(query);
    return RECORDS.filter((r) => {
      const text = words(`${r.brand} ${r.name} ${r.modelNumber ?? ""} ${r.mpn ?? ""}`);
      return q.length > 0 && q.every((w) => text.some((t) => t.startsWith(w)));
    }).map((r) => ({
      providerProductId: r.providerProductId,
      brand: r.brand,
      name: r.name,
      modelNumber: r.modelNumber,
      gtins: r.gtins,
    }));
  },
  async fetchById(id) {
    const r = RECORDS.find((x) => x.providerProductId === id);
    return r ? materialize(r) : null;
  },
  recordConfidence: () => 0.7,
};
