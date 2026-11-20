import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  affiliateClicks,
  priceHistory,
  products,
  productVariants,
  retailerOffers,
  retailers,
  reviewItems,
} from "@/db/schema";
import { seedDemoData } from "@/db/seed";
import { closeDb } from "@/lib/db";
import { getProductOffers } from "@/modules/offers/read";
import { recordAffiliateClick, resolveOfferRedirect } from "@/modules/offers/redirect";
import {
  createRetailerOffer,
  getPriceHistory,
  markOfferChecked,
  updateRetailerOffer,
} from "@/modules/offers/service";
import { archiveProduct } from "@/modules/products/service";
import { ctx, db, truncateAll } from "./helpers";

beforeAll(async () => {
  await truncateAll();
  await seedDemoData(db());
});
afterAll(closeDb);

async function ids() {
  const p = Object.fromEntries(
    (await db().select({ id: products.id, slug: products.slug }).from(products)).map((r) => [
      r.slug,
      r.id,
    ]),
  );
  const r = Object.fromEntries(
    (await db().select({ id: retailers.id, slug: retailers.slug }).from(retailers)).map((x) => [
      x.slug,
      x.id,
    ]),
  );
  const v = Object.fromEntries(
    (
      await db()
        .select({ id: productVariants.id, code: productVariants.variantCode })
        .from(productVariants)
    ).map((x) => [x.code, x.id]),
  );
  return { p, r, v };
}

const base = (productId: string, retailerId: string) => ({
  productId,
  retailerId,
  marketCountryCode: "PL",
  currency: "PLN",
  productUrl: "https://shop.demo-retailer-pl.example/p/test",
  priceAmount: "3999.00",
  availabilityStatus: "in_stock" as const,
  isDemo: true,
});

describe("offer services", () => {
  it("creates an offer and writes its first price_history row in the same transaction", async () => {
    const { p, r } = await ids();
    const { offer, suspicious } = await createRetailerOffer(ctx(), {
      ...base(p["pocket-3"]!, r["demo-retailer-pl"]!),
      priceAmount: 2199,
    });
    expect(offer.priceAmount).toBe("2199.0000");
    expect(suspicious).toBe(false); // nothing to compare with
    const history = await getPriceHistory(db(), offer.id);
    expect(history.map((h) => h.priceAmount)).toEqual(["2199.0000"]);
  });

  it("appends history only when the price or currency changes", async () => {
    const { p, r } = await ids();
    const { offer } = await createRetailerOffer(ctx(), {
      ...base(p["slate-13"]!, r["demo-retailer-pl"]!),
      priceAmount: "4100",
    });
    await updateRetailerOffer(ctx(), offer.id, { availabilityStatus: "out_of_stock" });
    await markOfferChecked(ctx(), offer.id);
    expect(await getPriceHistory(db(), offer.id)).toHaveLength(1);
    await updateRetailerOffer(ctx(), offer.id, { priceAmount: "3999" });
    await updateRetailerOffer(ctx(), offer.id, { priceAmount: "3999.0000" }); // same value
    const history = await getPriceHistory(db(), offer.id);
    expect(history.map((h) => h.priceAmount).sort()).toEqual(["3999.0000", "4100.0000"]);
  });

  it("refuses unsupported currencies, foreign hosts, insecure URLs and wrong variants", async () => {
    const { p, r, v } = await ids();
    const b = base(p["hush-4"]!, r["demo-retailer-pl"]!);
    await expect(createRetailerOffer(ctx(), { ...b, currency: "EUR" })).rejects.toThrow(
      /does not sell in EUR/,
    );
    await expect(
      createRetailerOffer(ctx(), { ...b, productUrl: "https://evil.example/x" }),
    ).rejects.toThrow(/allowed redirect hosts/);
    await expect(
      createRetailerOffer(ctx(), { ...b, affiliateUrl: "https://track.unknown.example/c" }),
    ).rejects.toThrow(/affiliateUrl/);
    await expect(
      createRetailerOffer(ctx(), { ...b, productUrl: "http://shop.demo-retailer-pl.example/x" }),
    ).rejects.toThrow(/https/);
    await expect(createRetailerOffer(ctx(), { ...b, variantId: v["1tb-us"] })).rejects.toThrow(
      /does not belong/,
    );
    await expect(createRetailerOffer(ctx(), { ...b, priceAmount: 0 })).rejects.toThrow(
      /greater than 0/,
    );
  });

  it("queues a suspicious_price review item for prices far from the median", async () => {
    const { p, r } = await ids();
    // Aera 7 Pro fresh PLN offers: 3349, 3899, 4449 (median 3899). 1499 is > 50% below.
    const before = await db()
      .select({ n: count() })
      .from(reviewItems)
      .where(eq(reviewItems.itemType, "suspicious_price"));
    const { offer, suspicious } = await createRetailerOffer(ctx(), {
      ...base(p["aera-7-pro"]!, r["demo-electro-pl"]!),
      productUrl: "https://www.demo-electro-pl.example/p/aera-used",
      condition: "used",
      priceAmount: "1499",
    });
    expect(suspicious).toBe(true);
    const after = await db().select().from(reviewItems).where(eq(reviewItems.entityId, offer.id));
    expect(after).toHaveLength(1);
    expect(after[0]!.payload).toMatchObject({ currency: "PLN", price: "1499.0000", median: 3899 });
    expect(
      (
        await db()
          .select({ n: count() })
          .from(reviewItems)
          .where(eq(reviewItems.itemType, "suspicious_price"))
      )[0]!.n,
    ).toBe(before[0]!.n + 1);
    await db()
      .update(retailerOffers)
      .set({ isActive: false })
      .where(eq(retailerOffers.id, offer.id));
  });
});

describe("getProductOffers", () => {
  it("returns displayable offers with retailer names; expired ones never appear", async () => {
    const { p } = await ids();
    const all = await getProductOffers(db(), p["vanta-14-2026"]!, null);
    expect(all.map((o) => o.retailerName).sort()).toEqual([
      "Demo Electro PL",
      "Demo Retailer DE",
      "Demo Retailer PL",
    ]);
  });

  it("filters to the selected variant plus offers not tied to a variant", async () => {
    const { p, v } = await ids();
    const only512 = await getProductOffers(db(), p["aera-7-pro"]!, v["512gb-eu"]!);
    expect(only512.every((o) => o.variantId === v["512gb-eu"] || o.variantId === null)).toBe(true);
    expect(only512.map((o) => o.priceAmount).sort()).toEqual(["4299.0000", "4449.0000"]);
  });

  it("hides offers from inactive retailers", async () => {
    const { p, r } = await ids();
    await db()
      .update(retailers)
      .set({ isActive: false })
      .where(eq(retailers.id, r["demo-retailer-de"]!));
    expect(
      (await getProductOffers(db(), p["ridge-7800"]!, null)).map((o) => o.marketCountryCode),
    ).toEqual(["US"]);
    await db()
      .update(retailers)
      .set({ isActive: true })
      .where(eq(retailers.id, r["demo-retailer-de"]!));
  });
});

describe("affiliate redirect", () => {
  async function offerId(product: string, retailer: string, extra = sql`TRUE`) {
    const [row] = await db().execute<{ id: string }>(sql`
      SELECT o.id FROM retailer_offers o JOIN products p ON p.id = o.product_id JOIN retailers r ON r.id = o.retailer_id
      WHERE p.slug = ${product} AND r.slug = ${retailer} AND ${extra} LIMIT 1`);
    return row!.id;
  }

  it("resolves to the stored product URL on an allowed host", async () => {
    const id = await offerId("ridge-7800", "demo-retailer-us");
    expect(await resolveOfferRedirect(db(), id, { demoEnabled: true })).toEqual({
      ok: true,
      redirect: { offerId: id, url: "https://shop.demo-retailer-us.example/p/ridge-7800" },
    });
  });

  it("prefers the affiliate URL when present", async () => {
    const id = await offerId("x9-3d", "demo-retailer-pl");
    await db()
      .update(retailers)
      .set({ allowedRedirectHosts: ["shop.demo-retailer-pl.example", "go.demo-network.example"] })
      .where(eq(retailers.slug, "demo-retailer-pl"));
    await db()
      .update(retailerOffers)
      .set({ affiliateUrl: "https://go.demo-network.example/c?o=x9" })
      .where(eq(retailerOffers.id, id));
    const r = await resolveOfferRedirect(db(), id, { demoEnabled: true });
    expect(r).toMatchObject({
      ok: true,
      redirect: { url: "https://go.demo-network.example/c?o=x9" },
    });
  });

  it("refuses when the stored host is not allowlisted (no open redirect)", async () => {
    const id = await offerId("hush-5", "demo-retailer-pl");
    await db()
      .update(retailerOffers)
      .set({ productUrl: "https://attacker.example/phish" })
      .where(eq(retailerOffers.id, id));
    expect(await resolveOfferRedirect(db(), id, { demoEnabled: true })).toEqual({
      ok: false,
      reason: "host_not_allowed",
    });
  });

  it.each([
    ["not-a-uuid", "invalid_id"],
    ["00000000-0000-4000-8000-000000000000", "not_found"],
  ])("rejects id %s", async (id, reason) => {
    expect(await resolveOfferRedirect(db(), id, { demoEnabled: true })).toEqual({
      ok: false,
      reason,
    });
  });

  it("refuses expired, inactive, inactive-retailer, unpublished-product and (when disabled) demo offers", async () => {
    const expired = await offerId("vanta-14-2026", "demo-retailer-us");
    expect(await resolveOfferRedirect(db(), expired, { demoEnabled: true })).toEqual({
      ok: false,
      reason: "expired",
    });

    const fresh = await offerId("ridge-7800", "demo-retailer-de");
    expect(await resolveOfferRedirect(db(), fresh, { demoEnabled: false })).toEqual({
      ok: false,
      reason: "demo_disabled",
    });

    await db()
      .update(retailers)
      .set({ isActive: false })
      .where(eq(retailers.slug, "demo-retailer-de"));
    expect(await resolveOfferRedirect(db(), fresh, { demoEnabled: true })).toEqual({
      ok: false,
      reason: "retailer_inactive",
    });
    await db()
      .update(retailers)
      .set({ isActive: true })
      .where(eq(retailers.slug, "demo-retailer-de"));

    await db().update(retailerOffers).set({ isActive: false }).where(eq(retailerOffers.id, fresh));
    expect(await resolveOfferRedirect(db(), fresh, { demoEnabled: true })).toEqual({
      ok: false,
      reason: "inactive",
    });
    await db().update(retailerOffers).set({ isActive: true }).where(eq(retailerOffers.id, fresh));

    const vista = await offerId("vista-27-ii", "demo-retailer-us");
    const [vp] = await db().select().from(products).where(eq(products.slug, "vista-27-ii"));
    await archiveProduct(ctx(), vp!.id);
    expect(await resolveOfferRedirect(db(), vista, { demoEnabled: true })).toEqual({
      ok: false,
      reason: "product_unavailable",
    });
  });

  it("records clicks without IPs, user agents or full referrer URLs", async () => {
    const id = await offerId("ridge-7800", "demo-retailer-us");
    await recordAffiliateClick(db(), {
      offerId: id,
      market: "US",
      referer: "https://news.example/a/b?c=d",
      userAgent: "Mozilla/5.0 Chrome/131",
    });
    await recordAffiliateClick(db(), {
      offerId: id,
      market: "nonsense",
      referer: null,
      userAgent: "Googlebot/2.1",
    });
    const rows = await db()
      .select()
      .from(affiliateClicks)
      .where(and(eq(affiliateClicks.offerId, id)));
    expect(rows.map((r) => [r.marketCountryCode, r.referrerHost, r.isProbableBot])).toEqual([
      ["US", "news.example", false],
      [null, null, true],
    ]);
    const cols = await db().execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'affiliate_clicks'`,
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      "clicked_at",
      "id",
      "is_probable_bot",
      "market_country_code",
      "offer_id",
      "referrer_host",
    ]);
  });
});

describe("price history is append-only in application code", () => {
  it("the offers service exposes no update/delete for price history", async () => {
    const mod = await import("@/modules/offers/service");
    expect(Object.keys(mod).filter((k) => /history/i.test(k))).toEqual(["getPriceHistory"]);
    expect((await db().select({ n: count() }).from(priceHistory))[0]!.n).toBeGreaterThan(0);
  });
});
