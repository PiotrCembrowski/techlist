import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs, productImages, providerQuotaUsage } from "@/db/schema";
import { parseEnv } from "@/config/env";
import { closeDb } from "@/lib/db";
import { setLogSink } from "@/lib/log";
import { getProductGallery } from "@/modules/media/public";
import { purgeExpiredResponses } from "@/modules/providers/core/cache";
import { httpClientFor, missingProviderConfig } from "@/modules/providers/core/config";
import { ProviderHttpClient, resetRequestSpacing } from "@/modules/providers/core/http";
import {
  getQuotaStatus,
  ProviderQuotaExceededError,
  reserveQuota,
  windowStart,
} from "@/modules/providers/core/quota";
import { registerAdapter, unregisterAdapter } from "@/modules/providers/core/registry";
import {
  getProviderSettings,
  providerAvailability,
  recordProviderHealth,
  setProviderEnabled,
} from "@/modules/providers/core/settings";
import type { ProviderAdapter } from "@/modules/providers/core/types";
import {
  approveReviewItem,
  createReviewItem,
  rejectReviewItem,
} from "@/modules/review-queue/service";
import { getProductById } from "@/modules/products/service";
import { ctx, db, makeProduct, truncateAll } from "./helpers";

const SECRET = "x".repeat(32);
const baseEnv = { DATABASE_URL: "postgres://u:p@localhost/db", AUTH_SECRET: SECRET };
const DAY = 86_400;

beforeEach(async () => {
  await truncateAll();
  resetRequestSpacing();
  setLogSink(() => {});
});
afterEach(() => setLogSink());
afterAll(closeDb);

describe("quota ledger", () => {
  it("never lets concurrent reservations exceed the limit", async () => {
    const rules = [{ bucket: "requests", limit: 7, windowSeconds: DAY }];
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserveQuota(db(), "upcitemdb", rules)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(7);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(13);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ProviderQuotaExceededError,
    );
    const [status] = await getQuotaStatus(db(), "upcitemdb", rules);
    expect(status).toMatchObject({ used: 7, remaining: 0, limit: 7 });
  });

  it("reserves all rules or none", async () => {
    const now = new Date("2026-11-25T10:00:00Z");
    const rules = [
      { bucket: "requests", limit: 100, windowSeconds: DAY },
      { bucket: "searches", limit: 1, windowSeconds: DAY },
    ];
    await reserveQuota(db(), "upcitemdb", rules, { now });
    await expect(reserveQuota(db(), "upcitemdb", rules, { now })).rejects.toMatchObject({
      bucket: "searches",
      resetsAt: new Date("2026-11-26T00:00:00Z"),
    });
    const rows = await db().select().from(providerQuotaUsage);
    expect(rows.find((r) => r.bucket === "requests")?.used).toBe(1); // not 2
  });

  it("starts a fresh window at midnight UTC", async () => {
    const rules = [{ bucket: "requests", limit: 1, windowSeconds: DAY }];
    await reserveQuota(db(), "icecat", rules, { now: new Date("2026-11-25T23:59:59Z") });
    await expect(
      reserveQuota(db(), "icecat", rules, { now: new Date("2026-11-25T23:59:59Z") }),
    ).rejects.toBeInstanceOf(ProviderQuotaExceededError);
    await reserveQuota(db(), "icecat", rules, { now: new Date("2026-11-26T00:00:00Z") });
    expect(windowStart(new Date("2026-11-26T15:00:00Z"), DAY).toISOString()).toBe(
      "2026-11-26T00:00:00.000Z",
    );
  });
});

describe("HTTP client with the ledger and the response cache", () => {
  const replies = () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ n: calls.length }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  };

  it("blocks the call before the quota is exceeded", async () => {
    const { calls, fetchFn } = replies();
    const c = new ProviderHttpClient({
      provider: "upcitemdb",
      db: db(),
      allowedHosts: ["api.example.test"],
      quotas: [{ bucket: "requests", limit: 2, windowSeconds: DAY }],
      minIntervalMs: 0,
      userAgent: "test",
      fetch: fetchFn,
    });
    await c.request("https://api.example.test/a");
    await c.request("https://api.example.test/b");
    await expect(c.request("https://api.example.test/c")).rejects.toBeInstanceOf(
      ProviderQuotaExceededError,
    );
    expect(calls).toHaveLength(2);
  });

  it("serves fresh cached responses without a call or quota, keyed without credentials", async () => {
    const { calls, fetchFn } = replies();
    let now = new Date("2026-11-25T10:00:00Z");
    const c = new ProviderHttpClient({
      provider: "icecat",
      db: db(),
      allowedHosts: ["api.example.test"],
      quotas: [{ bucket: "requests", limit: 10, windowSeconds: DAY }],
      minIntervalMs: 0,
      userAgent: "test",
      secretParams: ["username"],
      fetch: fetchFn,
      now: () => now,
    });
    const a = await c.request("https://api.example.test/p?id=1&username=alice", {
      cacheTtlSeconds: 3600,
    });
    const b = await c.request("https://api.example.test/p?id=1&username=bob", {
      cacheTtlSeconds: 3600,
    });
    expect(a.fromCache).toBe(false);
    expect(b).toMatchObject({ fromCache: true, body: a.body });
    expect(calls).toHaveLength(1);
    const [usage] = await getQuotaStatus(db(), "icecat", c["o"].quotas, now);
    expect(usage!.used).toBe(1);

    const [row] = await db().execute<{ request_url: string }>(
      sql`SELECT request_url FROM provider_response_cache`,
    );
    expect(row!.request_url).not.toMatch(/alice|bob/);

    now = new Date("2026-11-25T11:00:01Z"); // expired
    expect(
      (await c.request("https://api.example.test/p?id=1", { cacheTtlSeconds: 3600 })).fromCache,
    ).toBe(false);
    expect(calls).toHaveLength(2);
    expect(await purgeExpiredResponses(db(), new Date("2026-11-25T13:00:00Z"))).toBe(2); // both entries
  });
});

describe("provider settings", () => {
  const fake: ProviderAdapter = {
    key: "wikidata",
    displayName: "Wikidata (test double)",
    capabilities: {
      lookupByGtin: true,
      search: false,
      fetchById: true,
      specs: true,
      images: true,
      offers: false,
    },
    licence: {
      name: "CC0",
      url: null,
      usage: "store",
      attributionRequired: false,
      attribution: null,
      imageLicence: "per_image",
      unverified: true,
    },
    quotas: [],
    allowedHosts: ["api.example.test"],
    minIntervalMs: 0,
    missingConfig: (env) => missingProviderConfig("wikidata", env),
    healthCheck: async () => ({ status: "ok", message: null, checkedAt: new Date() }),
  };
  afterEach(() => unregisterAdapter("wikidata"));

  it("cannot enable a provider without an adapter or without its configuration", async () => {
    const env = parseEnv(baseEnv);
    await expect(setProviderEnabled(ctx(), "upcitemdb", true, env)).rejects.toThrow(/no adapter/);
    registerAdapter(fake);
    await expect(setProviderEnabled(ctx(), "wikidata", true, env)).rejects.toThrow(
      /WIKIDATA_USER_AGENT/,
    );
    expect(await providerAvailability(db(), "wikidata", env)).toMatchObject({
      runnable: false,
      reason: "not_configured",
    });
  });

  it("enables a configured provider (audited) and records health", async () => {
    registerAdapter(fake);
    const env = parseEnv({
      ...baseEnv,
      WIKIDATA_USER_AGENT: "Specbase/1.0 (https://example.test/contact)",
    });
    expect(await providerAvailability(db(), "wikidata", env)).toMatchObject({
      reason: "disabled",
    });
    await setProviderEnabled(ctx(), "wikidata", true, env);
    expect((await providerAvailability(db(), "wikidata", env)).runnable).toBe(true);
    const audit = await db()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "enable:wikidata"));
    expect(audit).toHaveLength(1);
    await recordProviderHealth(db(), "wikidata", {
      status: "error",
      message: "HTTP 503",
      checkedAt: new Date(),
    });
    expect(await getProviderSettings(db(), "wikidata")).toMatchObject({
      enabled: true,
      lastHealthStatus: "error",
      lastHealthMessage: "HTTP 503",
    });
    const http = httpClientFor(fake, env, db());
    expect(http.provider).toBe("wikidata");
  });
});

describe("import schema constraints", () => {
  it("keeps GTINs unique, 14 digits, and provider IDs unique per provider", async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    const ins = (productId: string, type: string, value: string, provider: string | null = null) =>
      db()
        .execute(sql`INSERT INTO product_identifiers (product_id, identifier_type, value, provider)
        VALUES (${productId}, ${type}::identifier_type, ${value}, ${provider})`);
    await ins(a.id, "gtin", "04006381333931");
    await expect(ins(b.id, "gtin", "04006381333931")).rejects.toThrow();
    await expect(ins(b.id, "gtin", "4006381333931")).rejects.toThrow(); // not GTIN-14
    await ins(a.id, "provider_product_id", "12345", "icecat");
    await expect(ins(b.id, "provider_product_id", "12345", "icecat")).rejects.toThrow();
    await ins(b.id, "provider_product_id", "12345", "upcitemdb");
    await expect(ins(b.id, "mpn", "X1", "icecat")).rejects.toThrow(); // provider only for provider IDs
  });

  it("stores an image as exactly one of an upload or an https remote URL", async () => {
    const p = await makeProduct();
    const ins = (key: string | null, url: string | null) =>
      db().execute(sql`INSERT INTO product_images (product_id, storage_key, remote_url, alt_text)
        VALUES (${p.id}, ${key}, ${url}, 'x')`);
    await expect(ins(null, null)).rejects.toThrow();
    await expect(ins("products/a.png", "https://img.example.test/a.png")).rejects.toThrow();
    await expect(ins(null, "http://img.example.test/a.png")).rejects.toThrow();
    await ins(null, "https://img.example.test/a.png");
  });

  it("dedupes only active provider jobs, and requires a provider and query for them", async () => {
    const [src] = await db().execute<{ id: string }>(
      sql`INSERT INTO sources (source_name, source_type) VALUES ('Open Icecat', 'licensed_provider') RETURNING id`,
    );
    const job = (status: string, dedupe: string | null, provider: string | null = "icecat") =>
      db()
        .execute(sql`INSERT INTO import_jobs (source_id, import_type, kind, provider, query, status, dedupe_key)
        VALUES (${src!.id}, 'products', 'provider', ${provider}, '{"mode":"gtin"}', ${status}::import_status, ${dedupe})`);
    await job("queued", "icecat:gtin:1");
    await expect(job("running", "icecat:gtin:1")).rejects.toThrow();
    await job("committed", "icecat:gtin:1"); // finished jobs don't block
    await expect(job("queued", null, null)).rejects.toThrow();
  });
});

describe("import review items", () => {
  it("image_rights: hidden until approved; rejection keeps it hidden", async () => {
    const p = await makeProduct();
    const [img] = await db()
      .insert(productImages)
      .values({
        productId: p.id,
        storageKey: "products/rights-test.png",
        altText: "Front",
        rightsStatus: "needs_review",
      })
      .returning();
    expect(await getProductGallery(db(), p.id, null)).toHaveLength(0);
    const item = await createReviewItem(db(), {
      itemType: "image_rights",
      entityType: "product_image",
      entityId: img!.id,
      payload: { productId: p.id, provider: "wikidata", licenseType: "CC BY-SA 4.0" },
      createdBy: null,
    });
    await approveReviewItem(ctx(), item.id);
    expect((await getProductGallery(db(), p.id, null)).map((i) => i.id)).toEqual([img!.id]);

    const again = await createReviewItem(db(), {
      itemType: "image_rights",
      entityType: "product_image",
      entityId: img!.id,
      payload: { productId: p.id },
      createdBy: null,
    });
    await rejectReviewItem(ctx(), again.id, "Licence does not allow reuse");
    expect(await getProductGallery(db(), p.id, null)).toHaveLength(0);
  });

  it("field_conflict: approve applies the value through the product service; reject keeps it", async () => {
    const p = await makeProduct({ name: "Kestrel 14", modelNumber: null });
    const mk = (proposed: string) =>
      createReviewItem(db(), {
        itemType: "field_conflict",
        entityType: "product",
        entityId: p.id,
        payload: {
          productId: p.id,
          variantId: null,
          field: "modelNumber",
          current: null,
          proposed,
          sourceId: null,
          provider: "icecat",
        },
        createdBy: null,
      });
    await rejectReviewItem(ctx(), (await mk("WRONG-1")).id, "Different product");
    expect((await getProductById(db(), p.id))!.modelNumber).toBeNull();
    await approveReviewItem(ctx(), (await mk("NK14-2609")).id);
    expect((await getProductById(db(), p.id))!.modelNumber).toBe("NK14-2609");

    const bad = await createReviewItem(db(), {
      itemType: "field_conflict",
      entityType: "product",
      entityId: p.id,
      payload: { productId: p.id, variantId: null, field: "isDemo", proposed: "true" },
      createdBy: null,
    });
    await expect(approveReviewItem(ctx(), bad.id)).rejects.toThrow(/cannot be changed/);
  });
});
