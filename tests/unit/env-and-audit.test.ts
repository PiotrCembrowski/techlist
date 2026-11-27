import { describe, expect, it } from "vitest";
import { parseEnv } from "@/config/env";
import { redact } from "@/modules/audit/service";
import { onlyProvided } from "@/modules/_shared/patch";

const SECRET = "x".repeat(32);

describe("env", () => {
  it("applies defaults and parses booleans", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://u:p@localhost/db",
      ENABLE_DEMO_DATA: "true",
      AUTH_SECRET: SECRET,
    });
    expect(env.OFFER_STALE_HOURS).toBe(72);
    expect(env.ENABLE_DEMO_DATA).toBe(true);
    expect(env.ALLOW_DEMO_SEED).toBe(false);
  });
  it("fails fast with a readable message", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: "postgres://x" })).toThrow(/AUTH_SECRET/);
    expect(() =>
      parseEnv({ DATABASE_URL: "postgres://x", AUTH_SECRET: SECRET, STORAGE_DRIVER: "ftp" }),
    ).toThrow(/STORAGE_DRIVER/);
    expect(() => parseEnv({ DATABASE_URL: "mysql://x" })).toThrow(/postgres/);
    expect(() => parseEnv({ DATABASE_URL: "postgres://x", OFFER_STALE_HOURS: "-1" })).toThrow(
      /OFFER_STALE_HOURS/,
    );
    expect(() => parseEnv({ DATABASE_URL: "postgres://x", AUTH_SECRET: "short" })).toThrow(
      /AUTH_SECRET/,
    );
  });
});

describe("audit redaction", () => {
  it("removes secret-looking keys at any depth", () => {
    const out = redact({
      email: "a@b.example",
      passwordHash: "x",
      nested: { apiKey: "k", token: "t", ok: 1 },
      searchVector: "v",
    });
    expect(out).toEqual({ email: "a@b.example", nested: { ok: 1 } });
  });
  it("serialises dates", () => {
    expect(redact({ at: new Date("2026-01-01T00:00:00Z") })).toEqual({
      at: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("onlyProvided", () => {
  it("drops defaults for keys the caller did not send", () => {
    expect(onlyProvided({ name: "A", isActive: true, aliases: [] }, { name: "A" })).toEqual({
      name: "A",
    });
  });
});

describe("provider env (import system)", () => {
  const base = { DATABASE_URL: "postgres://u:p@localhost/db", AUTH_SECRET: SECRET };
  it("runs with no provider configured, and with only Icecat and Wikidata", async () => {
    const { missingProviderConfig } = await import("@/modules/providers/core/config");
    const none = parseEnv(base);
    expect(none).toMatchObject({
      UPCITEMDB_ENABLED: false,
      UPCITEMDB_DAILY_BUDGET: 90,
      EBAY_ENABLED: false,
      EBAY_MARKETPLACE_ID: "EBAY_US",
      ICECAT_DEFAULT_LANG: "en",
      PROVIDER_LIVE_TESTS: false,
    });
    expect(missingProviderConfig("icecat", none)).toEqual(["ICECAT_USERNAME"]);
    const two = parseEnv({
      ...base,
      ICECAT_USERNAME: "openicecat-user",
      WIKIDATA_USER_AGENT: "Specbase/1.0 (https://example.test/contact)",
    });
    expect(missingProviderConfig("icecat", two)).toEqual([]);
    expect(missingProviderConfig("wikidata", two)).toEqual([]);
    expect(missingProviderConfig("upcitemdb", two)).toEqual(["UPCITEMDB_ENABLED=true"]);
    expect(missingProviderConfig("ebay", two)).toHaveLength(3);
  });
  it("treats empty strings as unset and validates provider settings", () => {
    expect(parseEnv({ ...base, ICECAT_USERNAME: "" }).ICECAT_USERNAME).toBeUndefined();
    expect(() => parseEnv({ ...base, WIKIDATA_USER_AGENT: "curl" })).toThrow(/WIKIDATA_USER_AGENT/);
    expect(() => parseEnv({ ...base, UPCITEMDB_DAILY_BUDGET: "101" })).toThrow(
      /UPCITEMDB_DAILY_BUDGET/,
    );
    expect(() => parseEnv({ ...base, EBAY_ENABLED: "true" })).toThrow(/EBAY_CLIENT_ID/);
    expect(() => parseEnv({ ...base, EBAY_MARKETPLACE_ID: "US" })).toThrow(/EBAY_MARKETPLACE_ID/);
  });
});

describe("remote images", () => {
  it("allows only https URLs on listed hosts, default port, no credentials", async () => {
    const { isAllowedRemoteImage, REMOTE_IMAGE_HOSTS } =
      await import("@/lib/security/remote-images");
    const hosts = ["img.example.test"];
    expect(isAllowedRemoteImage("https://img.example.test/a.jpg", hosts)).toBe(true);
    expect(isAllowedRemoteImage("http://img.example.test/a.jpg", hosts)).toBe(false);
    expect(isAllowedRemoteImage("https://img.example.test:444/a.jpg", hosts)).toBe(false);
    expect(isAllowedRemoteImage("https://u@img.example.test/a.jpg", hosts)).toBe(false);
    expect(isAllowedRemoteImage("https://sub.img.example.test/a.jpg", hosts)).toBe(false);
    expect(isAllowedRemoteImage("javascript:alert(1)", hosts)).toBe(false);
    // Only verified provider image hosts: Wikimedia Commons (D83); Icecat on purpose not (D81).
    expect(REMOTE_IMAGE_HOSTS).toEqual(["upload.wikimedia.org"]);
    expect(isAllowedRemoteImage("https://img.example.test/a.jpg")).toBe(false);
    expect(isAllowedRemoteImage("https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg")).toBe(
      true,
    );
    expect(isAllowedRemoteImage("https://images.icecat.biz/img/x.jpg")).toBe(false);
  });
  it("adds listed hosts to the CSP img-src", async () => {
    const { contentSecurityPolicy } = await import("@/lib/security/csp");
    const csp = contentSecurityPolicy("n", {
      dev: false,
      https: true,
      imageHosts: ["img.example.test"],
    });
    expect(csp).toContain("img-src 'self' data: blob: https://img.example.test;");
    expect(contentSecurityPolicy("n", { dev: false, https: true })).toContain(
      "img-src 'self' data: blob: https://upload.wikimedia.org;",
    );
  });
});

describe("import env defaults", () => {
  it("treats empty numeric settings as unset and allows the fixture provider only in demo mode", () => {
    const base = { DATABASE_URL: "postgres://u:p@localhost/db", AUTH_SECRET: SECRET };
    expect(
      parseEnv({ ...base, UPCITEMDB_DAILY_BUDGET: "", IMPORT_JOB_MAX_ITEMS: "" }),
    ).toMatchObject({
      UPCITEMDB_DAILY_BUDGET: 90,
      IMPORT_JOB_MAX_ITEMS: 500,
    });
    expect(() => parseEnv({ ...base, FIXTURE_PROVIDER: "true" })).toThrow(/ENABLE_DEMO_DATA/);
    expect(
      parseEnv({ ...base, FIXTURE_PROVIDER: "true", ENABLE_DEMO_DATA: "true" }).FIXTURE_PROVIDER,
    ).toBe(true);
  });
});
