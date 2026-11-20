import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/config/env";
import {
  AffiliateFeedProvider,
  CsvProductProvider,
  LicensedFeedProvider,
  listProviders,
  ManufacturerFilesProvider,
} from "@/modules/providers";

const SECRET = "x".repeat(32);

describe("provider adapters", () => {
  afterEach(() => vi.restoreAllMocks());
  const base = { DATABASE_URL: "postgres://u:p@localhost/db", AUTH_SECRET: SECRET };

  it("stubs are not configured without settings and never fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const p of listProviders(parseEnv(base))) {
      expect(p.isConfigured(), p.name).toBe(false);
      await expect(p.fetchProducts()).rejects.toThrow(/not configured/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with settings they report configured but still refuse (no implementation, no network)", async () => {
    const env = parseEnv({
      ...base,
      LICENSED_FEED_URL: "https://feed.provider.example/v1",
      LICENSED_FEED_API_KEY: "test-key",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const p = new LicensedFeedProvider(env);
    expect(p.isConfigured()).toBe(true);
    await expect(p.fetchProducts()).rejects.toThrow(/no adapter is implemented/);
    expect(new ManufacturerFilesProvider(env).isConfigured()).toBe(false);
    expect(new AffiliateFeedProvider(env).isConfigured()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the CSV adapter normalizes and validates records", async () => {
    const p = new CsvProductProvider("source-id", [
      {
        brand: "Novik",
        category_slug: "Laptops",
        product_name: "Kestrel 14",
        "spec.ram": "16 GB",
        gtin: "",
      },
      { brand: "Novik", category_slug: "laptops", product_name: "Bad", gtin: "123" },
    ]);
    const [ok, bad] = await p.fetchProducts();
    expect(await p.normalizeProduct(ok)).toMatchObject({
      brand: "Novik",
      categorySlug: "laptops",
      productName: "Kestrel 14",
      specs: { ram: "16 GB" },
      variant: null,
    });
    await expect(p.normalizeProduct(bad)).rejects.toThrow(/gtin/);
    expect(await p.fetchProducts({ limit: 1 })).toHaveLength(1);
  });
});
