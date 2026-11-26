import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/config/env";
import { setLogSink } from "@/lib/log";
import { gtinCheckDigit } from "@/lib/validation";
import { ensureAdaptersRegistered } from "@/modules/providers/adapters";
import {
  createIcecatAdapter,
  ICECAT_API_HOST,
  ICECAT_HEALTH_PRODUCT_ID,
  icecatDate,
  parseIcecatResponse,
} from "@/modules/providers/adapters/icecat";
import { missingProviderConfig } from "@/modules/providers/core/config";
import {
  ProviderHttpClient,
  ProviderHttpError,
  resetRequestSpacing,
} from "@/modules/providers/core/http";
import { getAdapter, unregisterAdapter } from "@/modules/providers/core/registry";
import type { ProviderContext } from "@/modules/providers/core/types";

/*
 * SYNTHETIC FIXTURES — not real Icecat output. The response shapes follow Icecat's
 * "Manual for Channel Partners: Icecat Product JSON" v3.1 (sections 6 and 9); the brand, product,
 * IDs and values are invented. GTINs use the GS1 restricted-circulation prefix 2.
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

const SECRET = "x".repeat(32);
const BASE = { DATABASE_URL: "postgres://u:p@localhost/db", AUTH_SECRET: SECRET };
const TOKEN = "0b6f2c1e-5a1d-4c3b-9e8f-7a6b5c4d3e2f"; // synthetic
const gtin13 = `200000003001${gtinCheckDigit("200000003001")}`;

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    msg: "OK",
    data: {
      GeneralInfo: {
        IcecatId: 990001,
        ReleaseDate: "12-05-2026",
        Title: 'Zorvik Quillo 7 Fixture Tablet 27.9 cm (11") 128 GB',
        TitleInfo: {
          GeneratedIntTitle: "Zorvik Quillo 7",
          GeneratedLocalTitle: { Value: "Zorvik Quillo 7", Language: "EN" },
        },
        Brand: "Zorvik",
        BrandID: "990",
        ProductName: "Quillo 7",
        BrandPartCode: "ZQ7-128-SL",
        GTIN: [gtin13],
        GTINs: [{ GTIN: gtin13, IsApproved: true }],
        Category: { CategoryID: "897", Name: { Value: "Tablets", Language: "EN" } },
        ProductFamily: { ProductFamilyID: "1", Value: "Quillo", Language: "EN" },
        ProductSeries: {},
        Description: {
          LongDesc: "<b>Synthetic</b> fixture description.",
          MiddleDesc: "",
          Language: "EN",
        },
      },
      FeaturesGroups: [
        {
          ID: 1,
          SortNo: "100",
          FeatureGroup: { ID: "10", Name: { Value: "Display", Language: "EN" } },
          Features: [
            {
              ID: 1001,
              Value: "27.9",
              RawValue: "27.9",
              PresentationValue: '27.9 cm (11")',
              Feature: {
                ID: "944",
                Sign: "",
                Measure: { ID: "29", Sign: "", Signs: { ID: "", _: "cm", Language: "EN" } },
                Name: { Value: "Display diagonal", Language: "EN" },
              },
            },
            {
              ID: 1002,
              Value: "Y",
              RawValue: "Y",
              PresentationValue: "Yes",
              Feature: {
                ID: "5",
                Sign: "",
                Measure: { ID: "0", Sign: "", Signs: { ID: "", _: "", Language: "EN" } },
                Name: { Value: "Touchscreen", Language: "EN" },
              },
            },
            {
              ID: 1003,
              Value: "",
              RawValue: "",
              Feature: { ID: "6", Name: { Value: "Empty feature", Language: "EN" } },
            },
          ],
        },
      ],
      CatalogObjectCloud: { ProductPage: { URL: "https://coc.example.test/p/990001" } },
      DemoAccount: false,
      ...overrides,
    },
  };
}

const errorBody = (StatusCode: number, Code: number, Message = "synthetic") => ({
  StatusCode,
  Code,
  Error: "x",
  Message,
});

describe("parseIcecatResponse", () => {
  it("maps a Product JSON data sheet to a ProviderRecord, keeping values as returned", () => {
    const now = new Date("2026-11-26T10:00:00Z");
    const r = parseIcecatResponse(200, JSON.stringify(okBody()), now)!;
    expect(r).toMatchObject({
      provider: "icecat",
      providerProductId: "990001",
      url: "https://coc.example.test/p/990001",
      brand: "Zorvik",
      name: "Zorvik Quillo 7",
      modelNumber: null,
      mpn: "ZQ7-128-SL",
      gtins: [gtin13],
      categoryExternalId: "897",
      categoryName: "Tablets",
      family: "Quillo",
      releaseDate: "2026-05-12",
      description: "<b>Synthetic</b> fixture description.",
      images: [],
      quality: null,
      retrievedAt: now,
    });
    expect(r.features).toEqual([
      { externalId: "944", name: "Display diagonal", value: "27.9", unit: "cm", group: "Display" },
      { externalId: "5", name: "Touchscreen", value: "Y", unit: null, group: "Display" },
    ]);
    expect(r.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parseIcecatResponse(200, JSON.stringify(okBody()))!.payloadHash).toBe(r.payloadHash);
  });

  it("falls back to the other titles and tolerates missing sections", () => {
    const body = okBody();
    const g = body.data.GeneralInfo as Record<string, unknown>;
    delete g.TitleInfo;
    g.ReleaseDate = "";
    g.Category = "unexpected";
    const data = body.data as Record<string, unknown>;
    delete data.FeaturesGroups;
    delete data.CatalogObjectCloud;
    const r = parseIcecatResponse(200, JSON.stringify(body))!;
    expect(r.name).toBe(g.Title);
    expect(r).toMatchObject({ releaseDate: null, categoryExternalId: null, url: null });
    expect(r.features).toEqual([]);
  });

  it("treats Icecat's not-found codes as no record", () => {
    for (const [code, http] of [
      [8, 404],
      [16, 400],
      [17, 404],
    ])
      expect(parseIcecatResponse(http!, JSON.stringify(errorBody(code!, http!)))).toBeNull();
    expect(
      parseIcecatResponse(404, JSON.stringify({ Code: 404, Error: "", Message: "x" })),
    ).toBeNull();
  });

  it("refuses Full Icecat and restricted products with a reason, without retrying", () => {
    const err = (status: number, body: unknown) => {
      try {
        parseIcecatResponse(status, JSON.stringify(body));
      } catch (e) {
        return e as ProviderHttpError;
      }
      throw new Error("expected an error");
    };
    const full = err(403, errorBody(9, 403));
    expect(full).toBeInstanceOf(ProviderHttpError);
    expect(full.retryable).toBe(false);
    expect(full.message).toMatch(/Full Icecat only/);
    expect(err(404, errorBody(14, 404)).message).toMatch(/restricted by the brand/);
    expect(err(404, errorBody(15, 404)).message).toMatch(/not released/);
    expect(err(404, errorBody(3, 404)).message).toMatch(/configuration: .*ICECAT_USERNAME/);
    expect(err(404, errorBody(18, 404)).message).toMatch(/ICECAT_API_TOKEN/);
    expect(err(400, errorBody(20, 400)).message).toMatch(/Icecat error 20/);
    expect(err(200, okBody({ DemoAccount: true })).message).toMatch(/public demo account/);
    expect(err(200, { msg: "Error", data: {} }).message).toMatch(/msg is not OK/);
    expect(err(200, { msg: "OK", data: { Gallery: [] } }).message).toMatch(/GeneralInfo/);
    expect(() => parseIcecatResponse(502, "<html>")).toThrow(/not JSON/);
  });

  it("converts only Icecat's documented DD-MM-YYYY dates", () => {
    expect(icecatDate("01-02-2026")).toBe("2026-02-01");
    expect(icecatDate("2026")).toBe("2026");
    expect(icecatDate(" ")).toBeNull();
  });
});

describe("Open Icecat adapter", () => {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  let replies: Response[] = [];
  const logs: string[] = [];

  const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: new URL(String(url)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return replies.shift() ?? new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  function setup(extraEnv: Record<string, string>) {
    const env = parseEnv({ ...BASE, ...extraEnv });
    const adapter = createIcecatAdapter(env);
    const http = new ProviderHttpClient({
      provider: adapter.key,
      db: null,
      allowedHosts: adapter.allowedHosts,
      quotas: adapter.quotas,
      minIntervalMs: 0,
      userAgent: "Specbase-test/1.0 (+https://example.test)",
      secretParams: adapter.secretParams,
      fetch: fakeFetch,
      sleep: async () => {},
    });
    const ctx = { db: null, http } as unknown as ProviderContext;
    return { adapter, ctx };
  }

  beforeEach(() => {
    calls.length = 0;
    logs.length = 0;
    replies = [];
    resetRequestSpacing();
    setLogSink((_level, line) => logs.push(line));
  });
  afterEach(() => setLogSink());

  it("declares the free Open Icecat terms, host and limits", () => {
    const { adapter } = setup({ ICECAT_USERNAME: "fixture-user" });
    expect(adapter.capabilities).toEqual({
      lookupByGtin: true,
      search: false,
      fetchById: true,
      specs: true,
      images: false,
      offers: false,
    });
    expect(adapter.allowedHosts).toEqual([ICECAT_API_HOST]);
    expect(ICECAT_API_HOST).toBe("live-origin.icecat.biz");
    expect(adapter.licence).toMatchObject({
      usage: "store",
      attributionRequired: true,
      imageLicence: "none",
      unverified: false,
    });
    expect(createIcecatAdapter(parseEnv(BASE), new Date("2027-01-02")).licence.attribution).toMatch(
      /^Database Right data-sheet 2027 Icecat\. All rights reserved\. .*“as is”/,
    );
    expect(adapter.quotas[0]!.limit * 31).toBeLessThan(1_000_000);
  });

  it("looks up a GTIN with the user name, and keeps the user name out of logs", async () => {
    const { adapter, ctx } = setup({ ICECAT_USERNAME: "fixture-user", ICECAT_DEFAULT_LANG: "en" });
    replies = [reply(okBody())];
    const records = await adapter.lookupByGtin!(gtin13.padStart(14, "0"), ctx);
    expect(records).toHaveLength(1);
    const { url, headers } = calls[0]!;
    expect(url.origin).toBe("https://live-origin.icecat.biz");
    expect(url.pathname).toBe("/api");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lang: "EN",
      shopname: "fixture-user",
      GTIN: gtin13.padStart(14, "0"),
      content: "generalinfo,featuregroups,catalogobjectcloud",
    });
    expect(headers["api-token"]).toBeUndefined();
    expect(headers["content-token"]).toBeUndefined();
    expect(logs.join("\n")).not.toContain("fixture-user");
  });

  it("sends the API token as a header instead of the user name, never the content token", async () => {
    const { adapter, ctx } = setup({
      ICECAT_USERNAME: "fixture-user",
      ICECAT_API_TOKEN: TOKEN,
      ICECAT_DEFAULT_LANG: "en_GB",
    });
    replies = [reply(okBody())];
    const r = await adapter.fetchById!("990001", ctx);
    expect(r?.providerProductId).toBe("990001");
    const { url, headers } = calls[0]!;
    expect(url.searchParams.get("shopname")).toBeNull();
    expect(url.searchParams.get("icecat_id")).toBe("990001");
    expect(url.searchParams.get("lang")).toBe("EN_GB");
    expect(headers["api-token"]).toBe(TOKEN);
    expect(JSON.stringify(calls)).not.toContain("content-token");
    expect(logs.join("\n")).not.toContain(TOKEN);
  });

  it("returns nothing for unknown products and refuses non-numeric IDs without a request", async () => {
    const { adapter, ctx } = setup({ ICECAT_USERNAME: "fixture-user" });
    replies = [reply(errorBody(16, 400), 400)];
    expect(await adapter.lookupByGtin!("00000000000000", ctx)).toEqual([]);
    await expect(adapter.fetchById!("ZQ7-128", ctx)).rejects.toThrow(/not an Icecat product ID/);
    expect(calls).toHaveLength(1);
  });

  it("health check: ok, configuration error, or degraded", async () => {
    const { adapter, ctx } = setup({ ICECAT_USERNAME: "fixture-user" });
    replies = [reply(okBody())];
    expect((await adapter.healthCheck(ctx)).status).toBe("ok");
    expect(calls[0]!.url.searchParams.get("icecat_id")).toBe(ICECAT_HEALTH_PRODUCT_ID);
    replies = [reply(errorBody(3, 404), 404)];
    expect(await adapter.healthCheck(ctx)).toMatchObject({ status: "error" });
    replies = [reply(errorBody(8, 404), 404)];
    expect(await adapter.healthCheck(ctx)).toMatchObject({ status: "degraded" });
  });

  it("needs a user name or an API token, and is registered", () => {
    const none = parseEnv(BASE);
    expect(missingProviderConfig("icecat", none)).toEqual(["ICECAT_USERNAME"]);
    expect(missingProviderConfig("icecat", parseEnv({ ...BASE, ICECAT_API_TOKEN: TOKEN }))).toEqual(
      [],
    );
    ensureAdaptersRegistered(none);
    expect(getAdapter("icecat")?.displayName).toBe("Open Icecat (free)");
    unregisterAdapter("icecat");
  });
});
