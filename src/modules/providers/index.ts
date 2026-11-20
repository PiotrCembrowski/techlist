import { getEnv, type Env } from "@/config/env";
import { applyMapping, autoMap } from "@/modules/imports/columns";
import { parseProductRow, type ProductRowData } from "@/modules/imports/products";
import { ValidationError } from "@/modules/_shared/errors";

/** A product in the shape every adapter produces (validated with Zod by parseProductRow). */
export type NormalizedProduct = ProductRowData;

/** SPEC §10: every data source is an adapter behind this interface. */
export interface ProductDataProvider {
  readonly name: string;
  readonly sourceId: string;
  isConfigured(): boolean;
  fetchProducts(options?: { since?: Date; limit?: number }): Promise<unknown[]>;
  normalizeProduct(raw: unknown): Promise<NormalizedProduct>;
}

export class ProviderNotAvailableError extends Error {}

/**
 * The fully implemented adapter: rows from an uploaded CSV file (the admin import uses the same
 * parsing and validation). It reads only what it is given — never the network.
 */
export class CsvProductProvider implements ProductDataProvider {
  readonly name = "CSV file";
  constructor(
    readonly sourceId: string,
    private readonly records: Record<string, string>[] = [],
  ) {}

  isConfigured() {
    return true;
  }

  async fetchProducts(options: { limit?: number } = {}) {
    return this.records.slice(0, options.limit ?? this.records.length);
  }

  async normalizeProduct(raw: unknown): Promise<NormalizedProduct> {
    if (!raw || typeof raw !== "object") throw new ValidationError("Expected a CSV record");
    const record = raw as Record<string, string>;
    const { data, issues } = parseProductRow(
      applyMapping(record, autoMap("products", Object.keys(record))),
    );
    if (!data)
      throw new ValidationError(
        issues.map((i) => (i.field ? `${i.field}: ${i.message}` : i.message)).join("; "),
        issues.map((i) => ({ path: i.field ?? "", message: i.message })),
      );
    return data;
  }
}

type EnvKey = keyof Env;

/**
 * Placeholder adapters for sources that need an agreement and credentials. They make no network
 * calls: without their settings they report "not configured"; with them they still refuse,
 * because no provider has been contracted and implemented yet (rule 2.1.10).
 */
abstract class StubProvider implements ProductDataProvider {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly requiredEnv: EnvKey[];
  readonly sourceId = "";

  /** `env` defaults to the validated process environment; tests pass their own. */
  constructor(private readonly env: Pick<Env, EnvKey> = getEnv()) {}

  isConfigured() {
    return this.requiredEnv.every((k) => Boolean(this.env[k]));
  }

  async fetchProducts(): Promise<unknown[]> {
    throw new ProviderNotAvailableError(
      this.isConfigured()
        ? `${this.name}: settings are present but no adapter is implemented yet (see docs/DATA_SOURCES.md)`
        : `${this.name} is not configured`,
    );
  }

  async normalizeProduct(): Promise<NormalizedProduct> {
    throw new ProviderNotAvailableError(`${this.name} is not available`);
  }
}

export class ManufacturerFilesProvider extends StubProvider {
  readonly name = "Manufacturer data files";
  readonly description =
    "Product data files supplied by manufacturers under an agreement (e.g. a shared folder or SFTP drop).";
  readonly requiredEnv: EnvKey[] = ["MANUFACTURER_FILES_DIR"];
}

export class LicensedFeedProvider extends StubProvider {
  readonly name = "Licensed specification feed";
  readonly description = "A commercial specification database licensed for publication.";
  readonly requiredEnv: EnvKey[] = ["LICENSED_FEED_URL", "LICENSED_FEED_API_KEY"];
}

export class AffiliateFeedProvider extends StubProvider {
  readonly name = "Affiliate product feed";
  readonly description = "Product and offer feeds from an approved affiliate network.";
  readonly requiredEnv: EnvKey[] = ["AFFILIATE_FEED_URL", "AFFILIATE_FEED_API_KEY"];
}

/** The adapters shown on the admin "Data providers" page. */
export function listProviders(env: Pick<Env, EnvKey> = getEnv()) {
  return [
    new ManufacturerFilesProvider(env),
    new LicensedFeedProvider(env),
    new AffiliateFeedProvider(env),
  ];
}
