import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { importJobs, providerMappings, providerSettings, sources } from "@/db/schema";
import type { Env } from "@/config/env";
import type { DbOrTx } from "@/lib/db";
import { PostgresRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import {
  InvalidStateError,
  NotFoundError,
  parseOrThrow,
  ValidationError,
} from "@/modules/_shared/errors";
import { brandKey } from "@/modules/import-core/identity";
import { TARGET_CATEGORIES } from "@/modules/import-core/catalog-config";
import { featureNameKey } from "@/modules/import-core/mappings";
import { featureTransformSchema } from "@/modules/import-core/normalize";
import { httpClientFor } from "@/modules/providers/core/config";
import { getQuotaStatus, type QuotaStatus } from "@/modules/providers/core/quota";
import { getAdapter } from "@/modules/providers/core/registry";
import {
  getProviderSettings,
  recordProviderHealth,
  type ProviderSettings,
} from "@/modules/providers/core/settings";
import {
  PROVIDER_KEYS,
  type ProviderAdapter,
  type ProviderHealth,
  type ProviderKey,
} from "@/modules/providers/core/types";

/**
 * Admin Product Import Center services (DECISIONS D80): provider overview and settings,
 * connection tests, mappings, coverage. Everything here is admin-only (the pages and actions call
 * requireAdmin/adminAction first).
 */

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  icecat: "Open Icecat",
  wikidata: "Wikidata / Wikimedia Commons",
  upcitemdb: "UPCitemdb (free plan)",
  ebay: "eBay Browse API",
  fixture: "Synthetic fixture data (demo only)",
};

export interface ProviderOverview {
  key: ProviderKey;
  label: string;
  adapter: ProviderAdapter | null;
  missing: string[];
  settings: ProviderSettings | null;
  dailyCap: number | null;
  syncEveryDays: number | null;
  quota: QuotaStatus[];
  source: { id: string; name: string; usagePermitted: boolean } | null;
  lastSuccessAt: Date | null;
  recentErrors: { at: Date; message: string; jobId: string }[];
}

const configOf = (s: ProviderSettings | null) =>
  (s?.config ?? {}) as { dailyCap?: number; syncEveryDays?: number };

/** Providers shown in the Import Center: the four free ones, plus the fixture when registered. */
export function visibleProviders(): ProviderKey[] {
  return [...PROVIDER_KEYS, ...(getAdapter("fixture") ? (["fixture"] as const) : [])];
}

export async function providerOverview(db: DbOrTx, env: Env): Promise<ProviderOverview[]> {
  const out: ProviderOverview[] = [];
  for (const key of visibleProviders()) {
    const adapter = getAdapter(key);
    const settings = await getProviderSettings(db, key);
    const cfg = configOf(settings);
    const rules = [
      ...(adapter?.quotas ?? []),
      ...(cfg.dailyCap
        ? [{ bucket: "daily_cap", limit: cfg.dailyCap, windowSeconds: 86_400 }]
        : []),
    ];
    const [source] = await db
      .select({ id: sources.id, name: sources.sourceName, usagePermitted: sources.usagePermitted })
      .from(sources)
      .where(eq(sources.providerKey, key));
    const [last] = await db
      .select({ at: importJobs.completedAt })
      .from(importJobs)
      .where(and(eq(importJobs.provider, key), eq(importJobs.status, "committed")))
      .orderBy(desc(importJobs.completedAt))
      .limit(1);
    const errors = await db.execute<{ at: string; message: string; job_id: string }>(sql`
      (SELECT i.updated_at::text AS at, i.error AS message, i.job_id FROM import_job_items i
         JOIN import_jobs j ON j.id = i.job_id
        WHERE j.provider = ${key} AND i.status = 'failed' AND i.error IS NOT NULL)
      UNION ALL
      (SELECT coalesce(completed_at, created_at)::text, last_error, id FROM import_jobs
        WHERE provider = ${key} AND last_error IS NOT NULL)
      ORDER BY at DESC LIMIT 5`);
    out.push({
      key,
      label: PROVIDER_LABELS[key],
      adapter,
      missing: adapter ? adapter.missingConfig(env) : [],
      settings,
      dailyCap: cfg.dailyCap ?? null,
      syncEveryDays: cfg.syncEveryDays ?? null,
      quota: rules.length ? await getQuotaStatus(db, key, rules) : [],
      source: source ?? null,
      lastSuccessAt: last?.at ?? null,
      recentErrors: errors.map((e) => ({
        at: new Date(e.at),
        message: e.message,
        jobId: e.job_id,
      })),
    });
  }
  return out;
}

/** Runs the adapter's health check (through the shared client and quota ledger) and records it. */
export async function testProviderConnection(
  ctx: ServiceContext,
  env: Env,
  provider: ProviderKey,
): Promise<ProviderHealth> {
  const adapter = getAdapter(provider);
  if (!adapter) throw new InvalidStateError(`${PROVIDER_LABELS[provider]} has no adapter yet`);
  const limit = await new PostgresRateLimiter(ctx.db).consume(
    rateLimitKey("provider-test", provider, ctx.actorId ?? "system"),
    6,
    3600,
  );
  if (!limit.allowed) throw new InvalidStateError("Too many connection tests; try again later");
  let health: ProviderHealth;
  const missing = adapter.missingConfig(env);
  if (missing.length) {
    health = {
      status: "not_configured",
      message: `Set ${missing.join(", ")}`,
      checkedAt: new Date(),
    };
  } else {
    try {
      health = await adapter.healthCheck({ db: ctx.db, http: httpClientFor(adapter, env, ctx.db) });
    } catch (e) {
      health = {
        status: "error",
        message: e instanceof Error ? e.message.slice(0, 300) : "Unknown error",
        checkedAt: new Date(),
      };
    }
  }
  await recordProviderHealth(ctx.db, provider, health);
  return health;
}

const providerConfigSchema = z.object({
  dailyCap: z.number().int().min(1).max(100_000).nullable(),
  syncEveryDays: z.number().int().min(1).max(365).nullable(),
});

/** Admin caps: a daily request cap (added to the quota ledger) and the scheduled re-sync interval. */
export async function updateProviderConfig(
  ctx: ServiceContext,
  provider: ProviderKey,
  input: z.input<typeof providerConfigSchema>,
): Promise<void> {
  const data = parseOrThrow(providerConfigSchema, input, "Invalid provider settings");
  await inTransaction(ctx, async (tx) => {
    const before = await getProviderSettings(tx, provider);
    const config = {
      ...((before?.config ?? {}) as Record<string, unknown>),
      dailyCap: data.dailyCap ?? undefined,
      syncEveryDays: data.syncEveryDays ?? undefined,
    };
    const clean = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    await tx
      .insert(providerSettings)
      .values({ provider, config: clean, updatedBy: ctx.actorId })
      .onConflictDoUpdate({
        target: providerSettings.provider,
        set: { config: clean, updatedBy: ctx.actorId },
      });
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "provider_settings",
      entityId: null,
      action: `config:${provider}`,
      previous: before?.config ?? null,
      next: clean,
    });
  });
}

// ─── Mappings ──────────────────────────────────────────────────────────────────────────

export const mappingInputSchema = z
  .object({
    provider: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
    mappingType: z.enum(["category", "feature", "brand"]),
    /** Provider ID; for features a name can be given instead (stored as `name:<name>`). */
    externalId: z.string().trim().min(1).max(200),
    byName: z.boolean().default(false),
    externalName: z.string().trim().max(200).nullish(),
    action: z.enum(["map", "ignore"]).default("map"),
    /** Feature mappings: our category whose definitions are the targets. */
    categoryId: z.uuid().nullish(),
    targetCategoryId: z.uuid().nullish(),
    targetBrandId: z.uuid().nullish(),
    /** Feature mappings: the definition key within categoryId. */
    definitionKey: z.string().trim().max(64).nullish(),
    unit: z.string().trim().max(20).nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict();

/** Creates or replaces one mapping (audited). */
export async function saveMapping(ctx: ServiceContext, input: z.input<typeof mappingInputSchema>) {
  const d = parseOrThrow(mappingInputSchema, input, "Invalid mapping");
  let externalId = d.externalId;
  if (d.mappingType === "feature" && d.byName) externalId = featureNameKey(d.externalId);
  if (d.mappingType === "brand") externalId = brandKey(d.externalId) ?? d.externalId;
  let targetDefinitionId: string | null = null;
  if (d.mappingType === "feature") {
    if (!d.categoryId)
      throw new ValidationError("Choose the category", [
        { path: "categoryId", message: "Required" },
      ]);
    if (d.action === "map") {
      if (!d.definitionKey)
        throw new ValidationError("Choose the specification", [
          { path: "definitionKey", message: "Required" },
        ]);
      const [def] = await ctx.db.execute<{ id: string }>(sql`
        WITH RECURSIVE chain(id, parent_id) AS (
          SELECT id, parent_id FROM categories WHERE id = ${d.categoryId}
          UNION ALL SELECT c.id, c.parent_id FROM categories c JOIN chain ON c.id = chain.parent_id)
        SELECT id FROM specification_definitions WHERE key = ${d.definitionKey} AND category_id IN (SELECT id FROM chain) LIMIT 1`);
      if (!def) throw new ValidationError(`No specification "${d.definitionKey}" in this category`);
      targetDefinitionId = def.id;
    }
  }
  if (d.action === "map" && d.mappingType === "category" && !d.targetCategoryId)
    throw new ValidationError("Choose our category", [
      { path: "targetCategoryId", message: "Required" },
    ]);
  if (d.action === "map" && d.mappingType === "brand" && !d.targetBrandId)
    throw new ValidationError("Choose our brand", [{ path: "targetBrandId", message: "Required" }]);
  const transform = d.unit ? featureTransformSchema.parse({ unit: d.unit }) : null;
  const scope = d.mappingType === "feature" ? (d.categoryId ?? null) : null;

  return inTransaction(ctx, async (tx) => {
    const values = {
      provider: d.provider,
      mappingType: d.mappingType,
      externalId,
      externalName: d.externalName ?? null,
      categoryId: scope,
      targetCategoryId:
        d.mappingType === "category" && d.action === "map" ? d.targetCategoryId! : null,
      targetBrandId: d.mappingType === "brand" && d.action === "map" ? d.targetBrandId! : null,
      targetDefinitionId,
      transform,
      action: d.action,
      notes: d.notes ?? null,
    };
    const [row] = await tx
      .insert(providerMappings)
      .values(values)
      .onConflictDoUpdate({
        target: [
          providerMappings.provider,
          providerMappings.mappingType,
          providerMappings.externalId,
          providerMappings.categoryId,
        ],
        set: values,
      })
      .returning();
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "provider_mapping",
      entityId: row!.id,
      action: "save",
      next: row,
    });
    return row!;
  });
}

export async function deleteMapping(ctx: ServiceContext, id: string) {
  await inTransaction(ctx, async (tx) => {
    const [row] = await tx.delete(providerMappings).where(eq(providerMappings.id, id)).returning();
    if (!row) throw new NotFoundError("Mapping", id);
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "provider_mapping",
      entityId: id,
      action: "delete",
      previous: row,
    });
  });
}

export async function listMappings(db: DbOrTx, provider: string) {
  return db.execute<{
    id: string;
    mapping_type: string;
    external_id: string;
    external_name: string | null;
    action: string;
    scope: string | null;
    target: string | null;
    unit: string | null;
  }>(sql`
    SELECT m.id, m.mapping_type, m.external_id, m.external_name, m.action,
           sc.name AS scope,
           coalesce(tc.name, b.name, d.name || ' (' || d.key || ')') AS target,
           m.transform->>'unit' AS unit
    FROM provider_mappings m
    LEFT JOIN categories sc ON sc.id = m.category_id
    LEFT JOIN categories tc ON tc.id = m.target_category_id
    LEFT JOIN brands b ON b.id = m.target_brand_id
    LEFT JOIN specification_definitions d ON d.id = m.target_definition_id
    WHERE m.provider = ${provider}
    ORDER BY m.mapping_type, sc.name NULLS FIRST, m.external_id
    LIMIT 2000`);
}

// ─── Coverage ──────────────────────────────────────────────────────────────────────────

export interface CoverageRow {
  slug: string;
  name: string;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
  /** Hits of the latest discovery searches run for this category, per provider. */
  searchHits: Record<string, number>;
  majorBrandsMissing: string[];
  majorBrandsPresent: string[];
}

/**
 * Where the free data falls short: per target category, products by status, products per
 * provider, discovery search hits, and which major brands have no products yet.
 */
export async function coverageReport(db: DbOrTx): Promise<CoverageRow[]> {
  const rows: CoverageRow[] = [];
  for (const c of TARGET_CATEGORIES) {
    const [cat] = await db.execute<{ id: string; name: string }>(
      sql`SELECT id, name FROM categories WHERE slug = ${c.slug}`,
    );
    if (!cat) {
      rows.push({
        slug: c.slug,
        name: c.name,
        byStatus: {},
        byProvider: {},
        searchHits: {},
        majorBrandsMissing: c.majorBrands,
        majorBrandsPresent: [],
      });
      continue;
    }
    const tree = sql`(WITH RECURSIVE t(id) AS (SELECT ${cat.id}::uuid UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id) SELECT id FROM t)`;
    const status = await db.execute<{ status: string; n: number }>(sql`
      SELECT status, count(*)::int AS n FROM products WHERE category_id IN ${tree} GROUP BY 1`);
    const providers = await db.execute<{ provider: string; n: number }>(sql`
      SELECT s.provider_key AS provider, count(DISTINCT r.product_id)::int AS n
      FROM product_source_records r JOIN sources s ON s.id = r.source_id AND s.provider_key IS NOT NULL
      JOIN products p ON p.id = r.product_id AND p.category_id IN ${tree}
      GROUP BY 1`);
    const hits = await db.execute<{ provider: string; n: number }>(sql`
      SELECT DISTINCT ON (provider) provider, (checkpoint->>'totalHits')::int AS n FROM import_jobs
      WHERE kind = 'provider' AND query->>'mode' = 'search' AND query->>'categoryId' = ${cat.id}
        AND checkpoint ? 'totalHits'
      ORDER BY provider, created_at DESC`);
    const brands = await db.execute<{ name: string; aliases: string[] }>(sql`
      SELECT DISTINCT b.name, b.aliases FROM brands b JOIN products p ON p.brand_id = b.id AND p.category_id IN ${tree}`);
    const present = new Set(
      brands.flatMap((b) => [b.name, ...b.aliases].map((n) => brandKey(n))).filter(Boolean),
    );
    rows.push({
      slug: c.slug,
      name: cat.name,
      byStatus: Object.fromEntries(status.map((s) => [s.status, Number(s.n)])),
      byProvider: Object.fromEntries(providers.map((p) => [p.provider, Number(p.n)])),
      searchHits: Object.fromEntries(hits.map((h) => [h.provider, Number(h.n)])),
      majorBrandsMissing: c.majorBrands.filter((b) => !present.has(brandKey(b))),
      majorBrandsPresent: c.majorBrands.filter((b) => present.has(brandKey(b))),
    });
  }
  return rows;
}
