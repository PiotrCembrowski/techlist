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
