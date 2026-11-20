import { describe, expect, it } from "vitest";
import { formatDate, formatPrice, formatRelative, formatSpecValue, marketName } from "@/lib/format";
import { parseMarket } from "@/lib/market";
import { formatQuantity } from "@/lib/units";
import { offerFreshness } from "@/modules/offers/freshness";
import { buildPrefixTsQuery, highlight, tokenize } from "@/modules/search/query";

describe("search query helpers", () => {
  it("tokenizes, folding accents and case", () => {
    expect(tokenize("Növik  Aera-7 Pro!")).toEqual(["novik", "aera", "7", "pro"]);
  });

  it("builds a prefix tsquery that cannot inject operators", () => {
    expect(buildPrefixTsQuery("Aera 7")).toBe("aera:* & 7:*");
    expect(buildPrefixTsQuery("a & b | !c :* <-> d")).toBe("a:* & b:* & c:* & d:*");
    expect(buildPrefixTsQuery("!!! ---")).toBeNull();
  });

  it("highlights every token, accent- and case-insensitively", () => {
    const parts = highlight("Novik Aera 7 Pro", "aera pro");
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["Aera", "Pro"]);
    expect(parts.map((p) => p.text).join("")).toBe("Novik Aera 7 Pro");
    expect(
      highlight("Ostrå Pro", "ostra")
        .filter((p) => p.match)
        .map((p) => p.text),
    ).toEqual(["Ostrå"]);
    expect(
      highlight("NA7P-2611", "na7p-2611")
        .filter((p) => p.match)
        .map((p) => p.text),
    ).toEqual(["NA7P", "2611"]);
  });

  it("returns the text unchanged with no tokens", () => {
    expect(highlight("Hush 5", "  ")).toEqual([{ text: "Hush 5", match: false }]);
  });
});

describe("formatting", () => {
  it("keeps prices in their original currency with the ISO code", () => {
    expect(formatPrice("3899.0000", "PLN")).toBe("PLN 3,899.00");
    expect(formatPrice(699.99, "USD")).toBe("USD 699.99");
  });

  it("formats dates and market names", () => {
    expect(formatDate("2026-03-04")).toBe("4 Mar 2026");
    expect(formatDate(null)).toBeNull();
    expect(marketName("PL")).toBe("Poland");
    expect(marketName("ALL")).toBe("All markets");
  });

  it("formats relative check times", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(formatRelative(new Date("2026-11-19T11:30:00Z"), now)).toBe("30 min ago");
    expect(formatRelative(new Date("2026-11-19T06:00:00Z"), now)).toBe("6 h ago");
    expect(formatRelative(new Date("2026-11-14T12:00:00Z"), now)).toBe("5 days ago");
  });

  it("formats spec values; null means no value, distinct from No", () => {
    const empty = {
      valueText: null,
      valueNumeric: null,
      valueBoolean: null,
      valueDate: null,
      valueJson: null,
    };
    expect(
      formatSpecValue(
        { dataType: "boolean", canonicalUnit: null },
        { ...empty, valueBoolean: false },
      ),
    ).toBe("No");
    expect(formatSpecValue({ dataType: "boolean", canonicalUnit: null }, null)).toBeNull();
    expect(
      formatSpecValue(
        { dataType: "integer", canonicalUnit: "mAh" },
        { ...empty, valueNumeric: "5000" },
      ),
    ).toBe("5,000 mAh");
    expect(
      formatSpecValue(
        { dataType: "multi_select", canonicalUnit: null },
        { ...empty, valueJson: ["Bluetooth", "3.5 mm jack"] },
      ),
    ).toBe("Bluetooth, 3.5 mm jack");
  });

  it("shows whole terabytes as TB for display only", () => {
    expect(formatQuantity(1000, "GB")).toBe("1 TB");
    expect(formatQuantity(2000, "GB")).toBe("2 TB");
    expect(formatQuantity(1500, "GB")).toBe("1,500 GB");
    expect(formatQuantity(512, "GB")).toBe("512 GB");
  });
});

describe("offer freshness", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
  it("classifies fresh, stale, expired and inactive offers", () => {
    expect(offerFreshness({ isActive: true, lastCheckedAt: h(2), expiresAt: null }, 72, now)).toBe(
      "fresh",
    );
    expect(offerFreshness({ isActive: true, lastCheckedAt: h(72), expiresAt: null }, 72, now)).toBe(
      "fresh",
    );
    expect(offerFreshness({ isActive: true, lastCheckedAt: h(73), expiresAt: null }, 72, now)).toBe(
      "stale",
    );
    expect(offerFreshness({ isActive: true, lastCheckedAt: h(1), expiresAt: h(1) }, 72, now)).toBe(
      "expired",
    );
    expect(offerFreshness({ isActive: false, lastCheckedAt: h(1), expiresAt: null }, 72, now)).toBe(
      "inactive",
    );
  });
});

describe("market cookie", () => {
  it("accepts country codes and ALL, defaults otherwise (no geo-detection)", () => {
    expect(parseMarket("PL")).toBe("PL");
    expect(parseMarket("ALL")).toBe("ALL");
    expect(parseMarket("pl")).toBe("ALL");
    expect(parseMarket("POL")).toBe("ALL");
    expect(parseMarket(undefined)).toBe("ALL");
  });
});
