import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/config/env";
import { setLogSink } from "@/lib/log";
import { parseQuantity } from "@/lib/units";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import {
  bestStatements,
  commonsImages,
  createWikidataAdapter,
  gtinSearch,
  isCacheableBody,
  parseApiBody,
  wikibaseDate,
  wikidataRecord,
} from "@/modules/providers/adapters/wikidata";
import { missingProviderConfig } from "@/modules/providers/core/config";
import {
  ProviderHttpClient,
  resetRequestSpacing,
  type ProviderHttpError,
} from "@/modules/providers/core/http";
import { getAdapter, unregisterAdapter } from "@/modules/providers/core/registry";
import type { ProviderContext } from "@/modules/providers/core/types";
import { z } from "zod";
import { ENTITY, IMAGEINFO, LABELS, item, label, str, time } from "../fixtures/wikidata";

/*
 * SYNTHETIC FIXTURES — not real Wikidata or Commons output. Shapes follow the Wikibase JSON
 * format and the MediaWiki Action API (wbgetentities, list=search, prop=imageinfo with
 * extmetadata), as seen on 2026-11-27; the items, IDs, labels, files and people are invented.
 */

// Ordinary tests must never reach the network: any real fetch fails the test.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("Real network call attempted in a unit test");
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const ent = (claims: Record<string, unknown[]>) =>
  ({ id: "Q1", claims }) as Parameters<typeof bestStatements>[0];

describe("Wikibase claims", () => {
  it("uses only best statements: preferred over normal, never deprecated or novalue", () => {
    const e = ent({
      P1: [
        str("P1", "a"),
        str("P1", "b", "string", "preferred"),
        str("P1", "c", "string", "deprecated"),
      ],
      P2: [str("P2", "x", "string", "deprecated"), str("P2", "y")],
      P3: [{ mainsnak: { snaktype: "somevalue", property: "P3" }, rank: "normal" }],
    });
    expect(bestStatements(e, "P1").map((s) => s.mainsnak.datavalue?.value)).toEqual(["b"]);
    expect(bestStatements(e, "P2").map((s) => s.mainsnak.datavalue?.value)).toEqual(["y"]);
    expect(bestStatements(e, "P3")).toEqual([]);
  });

  it("keeps dates only at the precision Wikidata states", () => {
    const at = (t: string, p: number) => wikibaseDate(ent({ P: [time("P", t, p)] }).claims!.P![0]!);
    expect(at("+2026-03-03T00:00:00Z", 11)).toBe("2026-03-03");
    expect(at("+2026-03-00T00:00:00Z", 10)).toBe("2026-03");
    expect(at("+2026-00-00T00:00:00Z", 9)).toBe("2026");
    expect(at("+2000-00-00T00:00:00Z", 8)).toBeNull(); // decade: not a release date
  });

  it("searches every stored form of a GTIN", () => {
    expect(gtinSearch("02000000050018")).toBe(
      "haswbstatement:P3962=02000000050018|P3962=2000000050018",
    );
    expect(gtinSearch("00012345678905")).toBe(
      "haswbstatement:P3962=00012345678905|P3962=0012345678905|P3962=012345678905",
    );
  });
});

describe("wikidataRecord", () => {
  const labels = new Map(Object.entries(LABELS)) as unknown as Parameters<typeof wikidataRecord>[1];
  const now = new Date("2026-11-27T12:00:00Z");

  it("maps an item and the labels it references, keeping values as Wikidata states them", () => {
    const r = wikidataRecord(ENTITY as never, labels, [], "h".repeat(64), now);
    expect(r).toMatchObject({
      provider: "wikidata",
      providerProductId: "Q990001",
      url: "https://www.wikidata.org/wiki/Q990001",
      name: "Zorvik Pell 3",
      brand: "Zorvik", // manufacturer, as there is no brand statement
      modelNumber: "ZP3-A",
      mpn: null,
      gtins: ["2000000050018"],
      categoryExternalId: "Q990101", // subclass of, not the generic "product model"
      categoryName: "fixture smartphone",
      family: "Pell",
      releaseDate: "2026-03-03",
      description: null,
      quality: null,
    });
    expect(r.features).toEqual([
      { externalId: "P990010", name: "storage capacity", value: "128", unit: "gigabyte" },
      { externalId: "P990011", name: "battery capacity", value: "4500", unit: "milliampere hour" },
      { externalId: "P990013", name: "operating system", value: "Fixture OS 3", unit: null },
      { externalId: "P990014", name: "inception", value: "2026-01", unit: null },
    ]);
    // The unit labels are understood by the unit registry.
    expect(parseQuantity("128 gigabyte", "GB")).toBe(128);
    expect(parseQuantity("1 terabyte", "GB")).toBe(1000);
    expect(parseQuantity("4500 milliampere hour", "mAh")).toBe(4500);
    expect(parseQuantity("2.2 gigahertz", "MHz")).toBe(2200);
  });

  it("never merges regional model numbers or several release dates; prefers the brand", () => {
    const e = structuredClone(ENTITY) as { claims: Record<string, unknown[] | undefined> };
    e.claims.P13351 = [str("P13351", "ZP3-EU"), str("P13351", "ZP3-US")];
    e.claims.P577 = [
      time("P577", "+2026-03-03T00:00:00Z", 11),
      time("P577", "+2026-04-01T00:00:00Z", 11),
    ];
    e.claims.P1716 = [item("P1716", "Q990300")];
    delete e.claims.P279;
    const r = wikidataRecord(e as never, labels, [], "h", now);
    expect(r).toMatchObject({
      modelNumber: null,
      releaseDate: null,
      brand: "Pell",
      categoryExternalId: "Q990100",
    });
  });
});

describe("commonsImages", () => {
  it("keeps each file's own author, licence, credit line, file page and restrictions", () => {
    const [img, ...rest] = commonsImages(IMAGEINFO as never);
    expect(rest).toEqual([]);
    expect(img).toEqual({
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Zorvik_Pell_3_front.jpg/960px-Zorvik_Pell_3_front.jpg",
      width: 960,
      height: 1280,
      author: "A. Fixture",
      licence: "CC BY-SA 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attribution: "A. Fixture, CC BY-SA 4.0, via Wikimedia Commons",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Zorvik_Pell_3_front.jpg",
      restrictions: ["trademarked"],
    });
  });

  it("skips non-free, unlicensed, missing and off-host files; honours a custom credit", () => {
    const page = (
      ext: Record<string, unknown>,
      url = IMAGEINFO.query.pages[0]!.imageinfo[0]!.url,
    ) => ({
      title: "File:X.jpg",
      imageinfo: [{ url, extmetadata: ext }],
    });
    const out = commonsImages({
      query: {
        pages: [
          page({ LicenseShortName: { value: "Fixture" }, NonFree: { value: "true" } }),
          page({ Artist: { value: "Nobody" } }),
          { title: "File:Missing.jpg", missing: true },
          page({ LicenseShortName: { value: "CC0" } }, "https://elsewhere.example/x.jpg"),
          page({
            LicenseShortName: { value: "Public domain" },
            Attribution: { value: "Fixture Museum" },
          }),
        ],
      },
    } as never);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      licence: "Public domain",
      attribution: "Fixture Museum",
      author: null,
    });
  });
});

describe("Action API responses", () => {
  const any = z.object({}).passthrough();
  const err = (status: number, body: unknown) => {
    try {
      parseApiBody(status, JSON.stringify(body), any);
    } catch (e) {
      return e as ProviderHttpError;
    }
    throw new Error("expected an error");
  };

  it("turns maxlag and rate limits into retry-later errors, other errors into failures", () => {
    const lag = err(200, { error: { code: "maxlag", info: "Waiting for a replica" } });
    expect(lag).toMatchObject({ retryable: true, retryAfterMs: 5_000 });
    expect(err(200, { error: { code: "ratelimited" } })).toMatchObject({ retryable: true });
    expect(err(200, { error: { code: "no-such-entity" } })).toMatchObject({ retryable: false });
    expect(err(403, {}).message).toMatch(/WIKIDATA_USER_AGENT/);
    expect(() => parseApiBody(200, "<html>", any)).toThrow(/not JSON/);
  });

  it("never caches error bodies", () => {
    expect(isCacheableBody('{"entities":{}}')).toBe(true);
    expect(isCacheableBody('{"error":{"code":"maxlag"}}')).toBe(false);
    expect(isCacheableBody("<html>")).toBe(false);
  });
});

describe("Wikidata adapter", () => {
  const calls: URL[] = [];
  const headers: Record<string, string>[] = [];
  let reply: (u: URL) => unknown = () => ({});
  const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push(u);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    return new Response(JSON.stringify(reply(u)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const adapter = createWikidataAdapter();
  const ctx = {
    db: null,
    http: new ProviderHttpClient({
      provider: adapter.key,
      db: null,
      allowedHosts: adapter.allowedHosts,
      quotas: adapter.quotas,
      minIntervalMs: 0,
      userAgent: "Specbase-test-bot/1.0 (https://example.test/contact)",
      fetch: fakeFetch,
      sleep: async () => {},
    }),
  } as unknown as ProviderContext;

  const fixtureApi = (u: URL) => {
    const p = u.searchParams;
    if (u.host === "commons.wikimedia.org") return IMAGEINFO;
    if (p.get("list") === "search")
      return { query: { search: [{ title: "Q990001" }, { title: "Property:P1" }] } };
    const ids = (p.get("ids") ?? "").split("|");
    if (ids.includes("Q990001")) return { entities: { Q990001: ENTITY } };
    return {
      entities: Object.fromEntries(
        ids.map((id) => [id, (LABELS as Record<string, unknown>)[id] ?? { id, missing: "" }]),
      ),
    };
  };

  beforeEach(() => {
    calls.length = 0;
    headers.length = 0;
    reply = fixtureApi;
    resetRequestSpacing();
    setLogSink(() => {});
  });
  afterEach(() => setLogSink());

  it("declares CC0 data, per-image licences, both hosts and the 2026 rate limit", () => {
    expect(adapter.allowedHosts).toEqual(["www.wikidata.org", "commons.wikimedia.org"]);
    expect(adapter.licence).toMatchObject({
      usage: "store",
      attributionRequired: false,
      imageLicence: "per_image",
      unverified: false,
    });
    expect(adapter.quotas).toEqual([{ bucket: "requests", limit: 150, windowSeconds: 60 }]);
    expect(adapter.minIntervalMs * 150).toBeLessThanOrEqual(60_000);
  });

  it("fetches an item, the labels it needs and its Commons image, politely", async () => {
    const r = await adapter.fetchById!("Q990001", ctx);
    expect(calls.map((u) => u.host)).toEqual([
      "www.wikidata.org",
      "www.wikidata.org",
      "commons.wikimedia.org",
    ]);
    for (const u of calls) {
      expect(u.pathname).toBe("/w/api.php");
      expect(u.searchParams.get("maxlag")).toBe("5");
      expect(u.searchParams.get("format")).toBe("json");
    }
    expect(calls[0]!.searchParams.get("props")).toBe("labels|descriptions|claims");
    expect(calls[1]!.searchParams.get("ids")!.split("|")).toEqual(
      expect.arrayContaining(["Q990101", "Q990200", "Q990300", "P990010", "Q990901"]),
    );
    // The preferred image only (best statements).
    expect(calls[2]!.searchParams.get("titles")).toBe("File:Zorvik Pell 3 front.jpg");
    expect(headers[0]!["user-agent"]).toMatch(/contact/);
    expect(r).toMatchObject({ name: "Zorvik Pell 3", brand: "Zorvik" });
    expect(r!.images).toHaveLength(1);
  });

  it("searches product models only, and looks GTINs up by statement", async () => {
    const hits = await adapter.search!("  zorvik   pell ", ctx);
    expect(calls[0]!.searchParams.get("srsearch")).toBe("zorvik pell haswbstatement:P176|P1716");
    expect(hits).toEqual([
      {
        providerProductId: "Q990001",
        brand: null,
        name: "Zorvik Pell 3",
        modelNumber: "ZP3-A",
        gtins: ["2000000050018"],
      },
    ]);
    calls.length = 0;
    const records = await adapter.lookupByGtin!("02000000050018", ctx);
    expect(calls[0]!.searchParams.get("srsearch")).toBe(gtinSearch("02000000050018"));
    expect(records.map((x) => x.providerProductId)).toEqual(["Q990001"]);
  });

  it("refuses bad IDs without a request; unknown items are not found; health check", async () => {
    await expect(adapter.fetchById!("P31", ctx)).rejects.toThrow(/not a Wikidata item ID/);
    expect(calls).toHaveLength(0);
    reply = () => ({ entities: { Q5: { id: "Q5", missing: "" } } });
    expect(await adapter.fetchById!("Q5", ctx)).toBeNull();
    reply = () => ({
      entities: { P3962: { id: "P3962", labels: label("Global Trade Item Number") } },
    });
    expect((await adapter.healthCheck(ctx)).status).toBe("ok");
    reply = () => ({ error: { code: "maxlag" } });
    expect((await adapter.healthCheck(ctx)).status).toBe("degraded");
  });

  it("needs a compliant User-Agent and is registered", () => {
    const base = { DATABASE_URL: "postgres://u:p@localhost/db", AUTH_SECRET: "x".repeat(32) };
    expect(missingProviderConfig("wikidata", parseEnv(base))).toEqual(["WIKIDATA_USER_AGENT"]);
    ensureAdaptersRegistered(parseEnv(base));
    expect(getAdapter("wikidata")?.displayName).toBe("Wikidata + Wikimedia Commons");
    unregisterAdapter("wikidata");
  });
});
