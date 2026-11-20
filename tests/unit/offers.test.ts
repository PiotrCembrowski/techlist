import { describe, expect, it } from "vitest";
import { compareOffers, daysSince, groupOffers, type DisplayOffer } from "@/modules/offers/display";
import { isProbableBot, referrerHost, validateRedirectTarget } from "@/modules/offers/redirect";
import { isSuspiciousPrice, median, moneySchema } from "@/modules/offers/service";

const now = new Date("2026-11-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

let n = 0;
function offer(over: Partial<DisplayOffer>): DisplayOffer {
  return {
    id: `o${n++}`,
    retailerName: "Shop",
    retailerSlug: "shop",
    marketCountryCode: "PL",
    currency: "PLN",
    priceAmount: "100.0000",
    originalPriceAmount: null,
    shippingCost: null,
    availabilityStatus: "in_stock",
    condition: "new",
    lastCheckedAt: hoursAgo(1),
    expiresAt: null,
    isActive: true,
    isDemo: true,
    variantId: null,
    variantName: null,
    ...over,
  };
}

describe("groupOffers", () => {
  const offers = [
    offer({ id: "pl-cheap", priceAmount: "90" }),
    offer({ id: "pl-oos", priceAmount: "50", availabilityStatus: "out_of_stock" }),
    offer({ id: "pl-stale", priceAmount: "80", lastCheckedAt: hoursAgo(120) }),
    offer({ id: "pl-expired", priceAmount: "10", expiresAt: hoursAgo(1) }),
    offer({ id: "pl-inactive", priceAmount: "10", isActive: false }),
    offer({ id: "de", marketCountryCode: "DE", currency: "EUR", priceAmount: "20" }),
    offer({
      id: "us",
      marketCountryCode: "US",
      currency: "USD",
      priceAmount: "30",
      lastCheckedAt: hoursAgo(100),
    }),
  ];

  it("puts the selected market first and other markets in their own groups", () => {
    const g = groupOffers(offers, "PL", 72, now);
    expect(g.primary.map((m) => m.market)).toEqual(["PL"]);
    expect(g.primary[0]!.fresh.map((o) => o.id)).toEqual(["pl-cheap", "pl-oos"]); // in stock before out of stock
    expect(g.primary[0]!.stale.map((o) => o.id)).toEqual(["pl-stale"]);
    expect(g.otherMarkets.map((m) => [m.market, m.fresh.length, m.stale.length])).toEqual([
      ["DE", 1, 0],
      ["US", 0, 1],
    ]);
    expect(g.total).toBe(5);
  });

  it("never shows expired or inactive offers", () => {
    const ids = groupOffers(offers, "ALL", 72, now)
      .primary.flatMap((m) => [...m.fresh, ...m.stale])
      .map((o) => o.id);
    expect(ids).not.toContain("pl-expired");
    expect(ids).not.toContain("pl-inactive");
  });

  it("with All markets, groups every market and collapses nothing", () => {
    const g = groupOffers(offers, "ALL", 72, now);
    expect(g.primary.map((m) => m.market)).toEqual(["DE", "PL", "US"]);
    expect(g.otherMarkets).toEqual([]);
  });

  it("shows an empty primary group when the market has no offers", () => {
    const g = groupOffers(offers, "CZ", 72, now);
    expect(g.primary).toEqual([]);
    expect(g.otherMarkets.length).toBe(3);
  });

  it("orders by availability, then currency, then price — never comparing across currencies", () => {
    const list = [
      offer({ id: "b", currency: "USD", priceAmount: "1" }),
      offer({ id: "a", currency: "EUR", priceAmount: "500" }),
      offer({ id: "c", currency: "EUR", priceAmount: "400", availabilityStatus: "preorder" }),
    ].sort(compareOffers);
    expect(list.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("counts whole days since the last check", () => {
    expect(daysSince(hoursAgo(121), now)).toBe(5);
    expect(daysSince(hoursAgo(1), now)).toBe(0);
  });
});

describe("validateRedirectTarget", () => {
  const allowed = ["shop.demo-retailer-pl.example", "Track.Affiliate.example"];

  it("accepts https URLs on an allowed host (case-insensitive, trailing dot)", () => {
    expect(
      validateRedirectTarget("https://shop.demo-retailer-pl.example/p/x?v=1", allowed),
    ).toEqual({
      ok: true,
      url: "https://shop.demo-retailer-pl.example/p/x?v=1",
    });
    expect(validateRedirectTarget("https://TRACK.affiliate.example./c?id=9", allowed).ok).toBe(
      true,
    );
    expect(validateRedirectTarget("https://shop.demo-retailer-pl.example:443/p", allowed).ok).toBe(
      true,
    );
  });

  it.each([
    ["http://shop.demo-retailer-pl.example/p", "unsafe_url"],
    ["javascript:alert(1)", "unsafe_url"],
    ["//shop.demo-retailer-pl.example/p", "unsafe_url"],
    ["https://user:pass@shop.demo-retailer-pl.example/p", "unsafe_url"],
    ["https://shop.demo-retailer-pl.example:8443/p", "unsafe_url"],
    ["not a url", "unsafe_url"],
    ["https://evil.example/p", "host_not_allowed"],
    ["https://shop.demo-retailer-pl.example.evil.example/p", "host_not_allowed"],
    ["https://sub.shop.demo-retailer-pl.example/p", "host_not_allowed"],
    ["https://demo-retailer-pl.example/p", "host_not_allowed"],
  ])("rejects %s", (url, reason) => {
    expect(validateRedirectTarget(url, allowed)).toEqual({ ok: false, reason });
  });

  it("rejects everything when the allowlist is empty", () => {
    expect(validateRedirectTarget("https://shop.demo-retailer-pl.example/p", [])).toEqual({
      ok: false,
      reason: "host_not_allowed",
    });
  });
});

describe("click metadata", () => {
  it("keeps only the referrer host", () => {
    expect(referrerHost("https://www.example.org/path/page?q=secret#x")).toBe("www.example.org");
    expect(referrerHost("garbage")).toBeNull();
    expect(referrerHost(null)).toBeNull();
  });

  it("flags probable bots by user-agent keywords (and missing user agents)", () => {
    expect(
      isProbableBot(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(isProbableBot("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(isProbableBot("curl/8.5.0")).toBe(true);
    expect(isProbableBot("Mozilla/5.0 HeadlessChrome/131.0")).toBe(true);
    expect(isProbableBot("")).toBe(true);
    expect(isProbableBot(null)).toBe(true);
  });
});

describe("prices", () => {
  it("computes medians", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("flags prices more than the deviation away from the median of the others", () => {
    expect(isSuspiciousPrice(100, [200, 210, 190], 0.5)).toBe(false); // exactly 50% below
    expect(isSuspiciousPrice(99, [200, 210, 190], 0.5)).toBe(true);
    expect(isSuspiciousPrice(301, [200], 0.5)).toBe(true);
    expect(isSuspiciousPrice(1, [], 0.5)).toBe(false); // nothing to compare with
  });

  it("stores money as fixed 4-decimal strings, never floats", () => {
    expect(moneySchema.parse("3899")).toBe("3899.0000");
    expect(moneySchema.parse(699.99)).toBe("699.9900");
    expect(moneySchema.parse(" 1 299.5 ")).toBe("1299.5000");
    expect(moneySchema.safeParse("-1").success).toBe(false);
    expect(moneySchema.safeParse("abc").success).toBe(false);
  });
});
