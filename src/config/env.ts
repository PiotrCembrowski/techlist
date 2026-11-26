import { z } from "zod";

/**
 * Server-side environment, validated once at startup (see src/instrumentation.ts).
 * Import `env` instead of reading `process.env` directly.
 */
const booleanString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

/** Empty strings (unset CI variables, blank .env lines) fall back to the default. */
const emptyAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

/** Empty strings count as unset (common in .env files). */
const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must be a postgres:// URL"),
    SITE_URL: z.url().default("http://localhost:3000"),
    ENABLE_DEMO_DATA: booleanString,
    ALLOW_DEMO_SEED: booleanString,
    OFFER_STALE_HOURS: z.coerce.number().int().positive().default(72),
    /** A new/changed offer price deviating more than this from the median current price (same product + currency) is queued for review. 0.5 = 50%. */
    SUSPICIOUS_PRICE_DEVIATION: z.coerce.number().positive().max(10).default(0.5),
    DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
    /** Auth.js secret for admin sessions (generate with `openssl rand -base64 32`). */
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    /** Uploaded images: "local" (development, STORAGE_LOCAL_DIR) or "s3" (any S3-compatible store). */
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().min(1).default("storage/uploads"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /**
     * How many reverse proxies in front of the app append to X-Forwarded-For. The client address
     * (used only, hashed, for rate limits) is the entry this many hops from the end. 0 = ignore the
     * header (all clients share one bucket). Wrong values let clients spoof their address.
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    /** Data provider adapters (SPEC §10). Unset = "Not configured"; see docs/DATA_ACQUISITION.md. */
    MANUFACTURER_FILES_DIR: z.string().optional(),
    LICENSED_FEED_URL: z.url().optional(),
    LICENSED_FEED_API_KEY: z.string().optional(),
    AFFILIATE_FEED_URL: z.url().optional(),
    AFFILIATE_FEED_API_KEY: z.string().optional(),

    // ── Free-data import providers (docs/product-import/). All optional: the app builds and runs
    //    with none of them; each provider runs only when configured here AND enabled in the admin.
    /** Open Icecat account name (free Open Icecat only; never Full Icecat). */
    ICECAT_USERNAME: optionalSecret,
    /** Open Icecat API token, if the account has one (sent only from the server). */
    ICECAT_API_TOKEN: optionalSecret,
    /** Open Icecat content token, if the account has one (sent only from the server). */
    ICECAT_CONTENT_TOKEN: optionalSecret,
    /** Language of Icecat content, e.g. `en`. */
    ICECAT_DEFAULT_LANG: z
      .string()
      .regex(/^[a-z]{2}(_[A-Z]{2})?$/, "ICECAT_DEFAULT_LANG must look like en or en_GB")
      .default("en"),
    /**
     * Wikimedia requires a descriptive User-Agent with contact details for API clients, e.g.
     * `Specbase/1.0 (https://example.com/contact; ops@example.com)`. Wikidata is off without it.
     */
    WIKIDATA_USER_AGENT: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined)
      .refine(
        (v) => v === undefined || (/\S+\/\S+/.test(v) && /(https?:\/\/|@)/.test(v)),
        "WIKIDATA_USER_AGENT must name the client (Name/version) and include a URL or an email address",
      ),
    /** UPCitemdb free trial endpoint (no key). Enrichment/cross-check only. Off unless true. */
    UPCITEMDB_ENABLED: booleanString,
    /** Our own daily cap for UPCitemdb lookups, kept below the provider's free limit. */
    UPCITEMDB_DAILY_BUDGET: emptyAsUnset(z.coerce.number().int().min(1).max(100).default(90)),
    /** eBay Browse API: Stage 7 only, after the licence report is approved. Off unless true. */
    EBAY_ENABLED: booleanString,
    EBAY_CLIENT_ID: optionalSecret,
    EBAY_CLIENT_SECRET: optionalSecret,
    EBAY_MARKETPLACE_ID: z
      .string()
      .regex(/^EBAY_[A-Z]{2,3}$/, "EBAY_MARKETPLACE_ID must look like EBAY_US")
      .default("EBAY_US"),
    /** Live provider smoke tests (`pnpm test:live`) run only when this is true. */
    PROVIDER_LIVE_TESTS: booleanString,
    /** Offline synthetic provider for tests and trying the Import Center; demo mode only. */
    FIXTURE_PROVIDER: booleanString,
    /** Hard cap on the items of one provider job (each job can lower it). */
    IMPORT_JOB_MAX_ITEMS: emptyAsUnset(z.coerce.number().int().min(1).max(5000).default(500)),
  })
  .superRefine((env, ctx) => {
    if (env.FIXTURE_PROVIDER && !env.ENABLE_DEMO_DATA) {
      ctx.addIssue({
        code: "custom",
        path: ["FIXTURE_PROVIDER"],
        message: "FIXTURE_PROVIDER=true is only allowed with ENABLE_DEMO_DATA=true",
      });
    }
    if (env.EBAY_ENABLED && !(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["EBAY_ENABLED"],
        message: "EBAY_ENABLED=true needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET",
      });
    }
  });
// SITE_URL defaults to localhost so local production builds (`next build`, e2e) work; deployments
// must set it (documented in .env.example and the README).

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily parsed so that importing this module never throws during tooling (e.g. lint). */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
