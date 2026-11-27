/**
 * Uses the SYNTHETIC fixture provider (labelled, offline) and a stub adapter. No real provider
 * data and no network calls.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  categories,
  importJobItems,
  importJobs,
  products,
  productSourceRecords,
  sources,
  specificationDefinitions,
} from "@/db/schema";
import { parseEnv } from "@/config/env";
import { closeDb } from "@/lib/db";
import { setLogSink } from "@/lib/log";
import { createBrand } from "@/modules/brands/service";
import { bootstrapCatalog } from "@/modules/import-core/bootstrap";
import type { RecordPreview } from "@/modules/import-jobs/preview";
import { claimNextJob, runJob, workLoop } from "@/modules/import-jobs/runner";
import {
  cancelJob,
  enqueueProviderJob,
  enqueueSyncJob,
  getProviderJob,
  retryFailedItems,
} from "@/modules/import-jobs/service";
import { ensureProviderSource } from "@/modules/import-jobs/sources";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import { fixtureAdapter } from "@/modules/providers/adapters/fixture";
import { ProviderHttpError } from "@/modules/providers/core/http";
import { ProviderQuotaExceededError } from "@/modules/providers/core/quota";
import { registerAdapter, unregisterAdapter } from "@/modules/providers/core/registry";
import { setProviderEnabled } from "@/modules/providers/core/settings";
import type { ProviderAdapter } from "@/modules/providers/core/types";
import { ConflictError } from "@/modules/_shared/errors";
import { ctx, db, truncateAll } from "./helpers";

const env = parseEnv({
  DATABASE_URL: "postgres://u:p@localhost/db",
  AUTH_SECRET: "x".repeat(32),
  ENABLE_DEMO_DATA: "true",
  FIXTURE_PROVIDER: "true",
  WIKIDATA_USER_AGENT: "Specbase-test/1.0 (https://example.test)",
  IMPORT_JOB_MAX_ITEMS: "20",
});
const future = () => new Date(Date.now() + 60_000);

async function confirmLicence(provider: string) {
  if (provider === "fixture") await ensureProviderSource(ctx(), fixtureAdapter);
  await db().update(sources).set({ usagePermitted: true }).where(eq(sources.providerKey, provider));
}

beforeEach(async () => {
  await truncateAll();
  setLogSink(() => {});
  await bootstrapCatalog(ctx());
  await createBrand(ctx(), { name: "Novik" });
  ensureAdaptersRegistered(env);
  await setProviderEnabled(ctx(), "fixture", true, env);
  const [phones] = await db().select().from(categories).where(eq(categories.slug, "smartphones"));
  const defs = await db()
    .select()
    .from(specificationDefinitions)
    .where(eq(specificationDefinitions.categoryId, phones!.id));
  const defId = (k: string) => defs.find((d) => d.key === k)!.id;
  await db().execute(sql`
    INSERT INTO provider_mappings (provider, mapping_type, external_id, target_category_id)
    VALUES ('fixture', 'category', 'fixture-phones', ${phones!.id})`);
  for (const [ext, key] of [
    ["FIX-storage", "storage"],
    ["FIX-ram", "ram"],
    ["FIX-battery", "battery_capacity"],
    ["FIX-screen", "screen_size"],
    ["FIX-os", "operating_system"],
  ] as const)
    await db().execute(sql`
      INSERT INTO provider_mappings (provider, mapping_type, external_id, target_definition_id)
      VALUES ('fixture', 'feature', ${ext}, ${defId(key)})`);
});
afterEach(() => {
  setLogSink();
  unregisterAdapter("wikidata");
});
afterAll(closeDb);

const drain = () =>
  workLoop(db(), { env, workerId: "test-worker", deadline: future(), drain: true });

describe("queueing provider jobs", () => {
  it("requires a confirmed licence, valid input and respects the cap; no duplicate jobs", async () => {
    await expect(
      enqueueProviderJob(ctx(), env, {
        provider: "fixture",
        query: { mode: "ids", values: ["FIX-1001"] },
      }),
    ).rejects.toThrow(/Confirm the licence/);
    await confirmLicence("fixture");
    await expect(
      enqueueProviderJob(ctx(), env, {
        provider: "fixture",
        query: { mode: "gtin", values: ["123"] },
      }),
    ).rejects.toThrow(/Invalid GTINs/);
    await expect(
      enqueueProviderJob(ctx(), env, {
        provider: "fixture",
        query: { mode: "ids", values: Array.from({ length: 21 }, (_, i) => `X${i}`) },
      }),
    ).rejects.toThrow(/cap of 20/);
    const job = await enqueueProviderJob(ctx(), env, {
      provider: "fixture",
      query: { mode: "ids", values: ["FIX-1001", "FIX-1001", "FIX-1002"] },
    });
    expect(job).toMatchObject({ status: "queued", kind: "provider", totalRows: 2 });
    await expect(
      enqueueProviderJob(ctx(), env, {
        provider: "fixture",
        query: { mode: "ids", values: ["FIX-1002", "FIX-1001"] },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      enqueueProviderJob(ctx(), env, {
        provider: "upcitemdb",
        query: { mode: "ids", values: ["1"] },
      }),
    ).rejects.toThrow(/no adapter/);
    // Open Icecat has an adapter, but this environment has no account configured.
    await expect(
      enqueueProviderJob(ctx(), env, { provider: "icecat", query: { mode: "ids", values: ["1"] } }),
    ).rejects.toThrow(/not configured \(ICECAT_USERNAME\)/);
  });
});

describe("running jobs", () => {
  beforeEach(() => confirmLicence("fixture"));

  it("previews a search without writing to the catalogue", async () => {
    const job = await enqueueProviderJob(ctx(), env, {
      provider: "fixture",
      query: { mode: "search", text: "novik lumen", dryRun: true },
    });
    await drain();
    const { job: done, items } = (await getProviderJob(db(), job.id))!;
    expect(done.status).toBe("committed");
    expect(done.checkpoint).toMatchObject({ discovered: true, totalHits: 3 });
    expect(items.map((i) => i.status)).toEqual(["skipped", "skipped", "skipped"]);
    const preview = (items[0]!.result as { preview: RecordPreview[] }).preview[0]!;
    expect(preview).toMatchObject({
      providerProductId: "FIX-1001",
      brandFound: true,
      eligible: true,
      match: { kind: "new" },
      category: { mappedTo: "smartphones" },
    });
    expect(preview.specs.map((s) => s.key)).toEqual(
      expect.arrayContaining(["storage", "ram", "battery_capacity"]),
    );
    expect(preview.unmappedFeatures).toBe(1);
    expect(preview.missing).toEqual(["Processor"]);
    expect(await db().select().from(products)).toHaveLength(0);
  });

  it("imports records as needs_review; a second run changes nothing", async () => {
    const job = await enqueueProviderJob(ctx(), env, {
      provider: "fixture",
      query: { mode: "ids", values: ["FIX-1001", "FIX-1002", "FIX-2001", "FIX-9999"] },
    });
    await drain();
    const { job: done, items } = (await getProviderJob(db(), job.id))!;
    expect(done).toMatchObject({
      status: "committed",
      totalRows: 4,
      successfulRows: 2,
      skippedRows: 1,
    });
    expect(items.map((i) => [i.externalKey, i.status])).toEqual([
      ["FIX-1001", "applied"],
      ["FIX-1002", "applied"],
      ["FIX-2001", "needs_review"], // unknown brand: blocked, waits for a brand mapping
      ["FIX-9999", "skipped"], // not returned by the provider: nothing changes
    ]);
    const all = await db().select().from(products);
    expect(all).toHaveLength(1); // two configurations of one model
    expect(all[0]!.status).toBe("needs_review");

    const again = await enqueueProviderJob(ctx(), env, {
      provider: "fixture",
      query: { mode: "gtin", values: [fixtureGtin("200000001001")] },
    });
    await drain();
    const { items: second } = (await getProviderJob(db(), again.id))!;
    expect(second[0]!.status).toBe("unchanged");
  });

  it("lets only one worker claim a job, and takes over an expired lease", async () => {
    await enqueueProviderJob(ctx(), env, {
      provider: "fixture",
      query: { mode: "ids", values: ["FIX-1001"] },
    });
    const [a, b] = await Promise.all([claimNextJob(db(), "w1"), claimNextJob(db(), "w2")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await claimNextJob(db(), "w3")).toBeNull();
    await db()
      .update(importJobs)
      .set({ lockedUntil: new Date(Date.now() - 1000) });
    const taken = await claimNextJob(db(), "w3");
    expect(taken).toMatchObject({ lockedBy: "w3", attempts: 2 });
  });

  it("pauses at the deadline and resumes where it stopped", async () => {
    const job = await enqueueProviderJob(ctx(), env, {
      provider: "fixture",
      query: { mode: "ids", values: ["FIX-1001", "FIX-1002", "FIX-1003"] },
    });
    const claimed = (await claimNextJob(db(), "w1"))!;
    let calls = 0;
    const deadline = new Date(Date.now() + 60_000);
    const result = await runJob(db(), claimed, {
      env,
      workerId: "w1",
      deadline,
      batchSize: 1,
      // The clock passes the deadline after the first item.
      now: () => (calls++ > 2 ? new Date(deadline.getTime() + 1) : new Date()),
    });
    expect(result).toBe("paused");
    const mid = (await getProviderJob(db(), job.id))!;
    expect(mid.job).toMatchObject({ status: "queued", lockedBy: null });
    expect(mid.items.filter((i) => i.status === "pending").length).toBeGreaterThan(0);
    await drain();
    const end = (await getProviderJob(db(), job.id))!;
    expect(end.job.status).toBe("committed");
    expect(end.items.every((i) => i.status !== "pending")).toBe(true);
  });

  it("cancels queued jobs at once and running jobs between items", async () => {
    const queued = await enqueueProviderJob(ctx(), env, {
      provider: "fixture",
      query: { mode: "ids", values: ["FIX-1001"] },
    });
    expect((await cancelJob(ctx(), queued.id)).status).toBe("cancelled");
    const running = await enqueueProviderJob(ctx(), env, {
      provider: "fixture",
      query: { mode: "ids", values: ["FIX-1002"] },
    });
    const claimed = (await claimNextJob(db(), "w1"))!;
    expect(claimed.id).toBe(running.id);
    await cancelJob(ctx(), running.id);
    expect(await runJob(db(), claimed, { env, workerId: "w1", deadline: future() })).toBe(
      "cancelled",
    );
    expect(await db().select().from(products)).toHaveLength(0);
  });

  it("queues re-sync jobs for records not seen recently", async () => {
    await enqueueProviderJob(ctx(), env, {
      provider: "fixture",
      query: { mode: "ids", values: ["FIX-1001"] },
    });
    await drain();
    expect(await enqueueSyncJob(ctx(), env, "fixture", 7)).toBeNull();
    await db()
      .update(productSourceRecords)
      .set({ lastSeenAt: new Date("2026-01-01T00:00:00Z") });
    const sync = await enqueueSyncJob(ctx(), env, "fixture", 7);
    expect(sync!.query).toMatchObject({ mode: "ids", values: ["FIX-1001"], sync: true });
    expect(await enqueueSyncJob(ctx(), env, "fixture", 7)).toBeNull(); // already queued
  });
});

function fixtureGtin(body12: string) {
  return fixtureAdapter.lookupByGtin ? `${body12}${checkDigit(body12)}` : body12;
}
function checkDigit(body: string) {
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10;
}

describe("failures", () => {
  let behaviour: (id: string) => Promise<null>;
  const stub: ProviderAdapter = {
    ...fixtureAdapter,
    key: "wikidata",
    displayName: "Stub adapter",
    missingConfig: () => [],
    fetchById: (id) => behaviour(id),
  };

  beforeEach(async () => {
    registerAdapter(stub);
    await setProviderEnabled(ctx(), "wikidata", true, env);
    await ensureProviderSource(ctx(), stub);
    await confirmLicence("wikidata");
  });

  it("waits for the quota to reset instead of failing", async () => {
    const resetsAt = new Date(Date.now() + 3_600_000);
    behaviour = async () => {
      throw new ProviderQuotaExceededError("wikidata", "requests", 10, resetsAt);
    };
    const job = await enqueueProviderJob(ctx(), env, {
      provider: "wikidata",
      query: { mode: "ids", values: ["A"] },
    });
    await drain();
    const { job: after, items } = (await getProviderJob(db(), job.id))!;
    expect(after).toMatchObject({ status: "queued", lockedBy: null });
    expect(after.runAfter.getTime()).toBe(resetsAt.getTime());
    expect(items[0]!.status).toBe("pending");
  });

  it("fails bad items, keeps going, and retries only the failed ones", async () => {
    let broken = true;
    behaviour = async (id) => {
      if (id === "BAD" && broken) throw new ProviderHttpError("wikidata", "HTTP 400", 400, false);
      return null;
    };
    const job = await enqueueProviderJob(ctx(), env, {
      provider: "wikidata",
      query: { mode: "ids", values: ["OK", "BAD"] },
    });
    await drain();
    let state = (await getProviderJob(db(), job.id))!;
    expect(state.job.status).toBe("committed");
    expect(state.items.map((i) => [i.externalKey, i.status])).toEqual([
      ["OK", "skipped"],
      ["BAD", "failed"],
    ]);
    expect(state.items[1]!.error).toMatch(/HTTP 400/);
    broken = false;
    expect(await retryFailedItems(ctx(), job.id)).toBe(1);
    await drain();
    state = (await getProviderJob(db(), job.id))!;
    expect(state.items.map((i) => i.status)).toEqual(["skipped", "skipped"]);
    const attempts = await db()
      .select({ a: importJobItems.attempts, k: importJobItems.externalKey })
      .from(importJobItems);
    expect(attempts.find((x) => x.k === "OK")!.a).toBe(1); // not re-run
  });

  it("fails the job when the provider is switched off", async () => {
    behaviour = async () => null;
    const job = await enqueueProviderJob(ctx(), env, {
      provider: "wikidata",
      query: { mode: "ids", values: ["A"] },
    });
    await setProviderEnabled(ctx(), "wikidata", false, env);
    await drain();
    expect((await getProviderJob(db(), job.id))!.job).toMatchObject({
      status: "failed",
      lastError: expect.stringMatching(/disabled/),
    });
  });
});
