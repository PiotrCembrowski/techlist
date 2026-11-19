import { z } from "zod";

/**
 * Server-side environment, validated once at startup (see src/instrumentation.ts).
 * Import `env` instead of reading `process.env` directly.
 */
const booleanString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must be a postgres:// URL"),
  SITE_URL: z.url().default("http://localhost:3000"),
  ENABLE_DEMO_DATA: booleanString,
  ALLOW_DEMO_SEED: booleanString,
  OFFER_STALE_HOURS: z.coerce.number().int().positive().default(72),
  DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  // Required from Stage 6A (admin auth). Optional until then, but if set it must be strong.
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters").optional(),
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
