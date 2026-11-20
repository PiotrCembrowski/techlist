import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brands, products, retailerOffers } from "@/db/schema";
import { seedDemoData } from "@/db/seed";
import { closeDb } from "@/lib/db";
import { PostgresRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { parseCatalogFilters, type RawSearchParams } from "@/modules/catalog/filters";
import {
  getBrandPageData,
  getCategoryPageData,
  getCategoryTree,
  listBrandsByProductCount,
} from "@/modules/catalog/pages";
import { listCatalog, type CatalogOptions } from "@/modules/catalog/service";
import { getLowestFreshOffers, getMarketCurrencies, listMarkets } from "@/modules/offers/read";
import { createProduct, publishProduct, updateProduct } from "@/modules/products/service";
import { loadProductPage } from "@/modules/products/public";
import { PostgresSearchService } from "@/modules/search/service";
import { ctx, db, truncateAll } from "./helpers";

const ALL: CatalogOptions = { market: "ALL", staleHours: 72, priceCurrency: null };
const PL: CatalogOptions = { market: "PL", staleHours: 72, priceCurrency: "PLN" };

beforeAll(async () => {
  await truncateAll();
  await seedDemoData(db());
});
afterAll(closeDb);

async function category(slug: string) {
  const page = await getCategoryPageData(db(), slug);
  if (page.kind !== "ok") throw new Error(`category ${slug} not found`);
  return page.data;
}

async function list(slug: string, raw: RawSearchParams, opts: CatalogOptions = ALL) {
  const c = await category(slug);
  const r = await listCatalog(
    db(),
    { categoryIds: c.scopeIds },
    parseCatalogFilters(raw, c.filterable),
    opts,
  );
  return { ...r, slugs: r.items.map((i) => i.slug).sort() };
}

describe("category pages", () => {
  it("generate filters from filterable definitions, including inherited ones", async () => {
    const gaming = await category("gaming-laptops");
    const keys = gaming.filterable.map((d) => d.key);
    expect(keys).toEqual(
      expect.arrayContaining(["ram", "storage", "weight", "refresh_rate", "gpu_power"]),
    );
    const headphones = await category("headphones");
    expect(headphones.filterable.map((d) => d.key)).not.toContain("vram");
    expect(headphones.filterable.map((d) => d.key)).toEqual(
      expect.arrayContaining(["form_factor", "noise_cancelling", "connectivity"]),
    );
  });

  it("include products of subcategories and list children, brands and guides", async () => {
    const laptops = await category("laptops");
    expect(laptops.children.map((c) => [c.slug, c.productCount])).toEqual([["gaming-laptops", 1]]);
    expect((await list("laptops", {})).slugs).toContain("strand-g16");
    expect(laptops.brands.map((b) => b.slug).sort()).toEqual(["corvala", "halden", "novik"]);
    expect(laptops.guides.map((g) => g.slug)).toContain("laptop-weight-vs-battery");
  });

  it("redirect old slugs and 404 unknown ones", async () => {
    expect(await getCategoryPageData(db(), "does-not-exist")).toEqual({ kind: "not_found" });
  });
});

describe("catalogue filter queries", () => {
  it("numeric ranges in canonical units", async () => {
    expect((await list("laptops", { "s.ram.min": "32" })).slugs).toEqual([
      "strand-g16",
      "vanta-14-2026",
    ]);
    expect((await list("laptops", { "s.weight.max": "1.4" })).slugs).toEqual([
      "slate-13",
      "vanta-14-2026",
    ]);
    // Vanta 14 (2026) matches through its 16 GB variant ("available with" semantics).
    expect((await list("laptops", { "s.ram.min": "16", "s.ram.max": "16" })).slugs).toEqual([
      "brisk-15",
      "slate-13",
      "vanta-14-2025",
      "vanta-14-2026",
    ]);
  });

  it("matches variant-level values too (available with ≥ 1 TB)", async () => {
    expect((await list("smartphones", { "s.storage.min": "1000" })).slugs).toEqual(["aera-7-pro"]);
  });

  it("enum options (any of) and multi-select", async () => {
    expect((await list("monitors", { "s.panel_type": "OLED" })).slugs).toEqual(["lumen-27q"]);
    expect((await list("monitors", { "s.panel_type": ["OLED", "IPS"] })).total).toBe(3);
    expect((await list("headphones", { "s.connectivity": "USB-C audio" })).slugs).toEqual([
      "hush-5",
    ]);
  });

  it("boolean: No is a value, missing is not", async () => {
    expect((await list("headphones", { "s.noise_cancelling": "yes" })).slugs).toEqual([
      "hush-4",
      "hush-5",
      "pebble-buds-2",
    ]);
    expect((await list("headphones", { "s.noise_cancelling": "no" })).slugs).toEqual(["arden"]);
    expect((await list("monitors", { "s.hdr_support": "no" })).slugs).toEqual(["vista-27"]);
    // Pocket 3 stores wireless_charging = No; products without a value never match either way.
    // (wireless_charging is not filterable, so the parameter is ignored entirely.)
    expect((await list("smartphones", { "s.wireless_charging": "no" })).total).toBe(4);
  });

  it("inherited filters work on the child category", async () => {
    expect(
      (await list("gaming-laptops", { "s.refresh_rate.min": "200", "s.gpu_power.min": "100" }))
        .slugs,
    ).toEqual(["strand-g16"]);
  });

  it("brand, status and free-text filters combine", async () => {
    expect((await list("laptops", { brand: "halden", status: "discontinued" })).slugs).toEqual([
      "vanta-14-2025",
    ]);
    expect((await list("laptops", { q: "vanta" })).slugs).toEqual([
      "vanta-14-2025",
      "vanta-14-2026",
    ]);
    expect((await list("laptops", { q: "HV14-26-H7P" })).slugs).toEqual(["vanta-14-2026"]);
  });

  it("paginates with stable ordering", async () => {
    const c = await category("smartphones");
    const page1 = await listCatalog(
      db(),
      { categoryIds: c.scopeIds },
      parseCatalogFilters({ sort: "name" }),
      { ...ALL, pageSize: 2 },
    );
    const page2 = await listCatalog(
      db(),
      { categoryIds: c.scopeIds },
      parseCatalogFilters({ sort: "name", page: "2" }),
      { ...ALL, pageSize: 2 },
    );
    expect(page1).toMatchObject({ total: 4, pageCount: 2 });
    expect([...page1.items, ...page2.items].map((i) => i.name)).toEqual([
      "Aera 6 Pro",
      "Aera 7 Pro",
      "Pocket 3",
      "Strand S",
    ]);
  });

  it("builds cards with up to four key specs and no N+1 surprises", async () => {
    const { items } = await list("laptops", {});
    const vanta = items.find((i) => i.slug === "vanta-14-2026")!;
    expect(vanta.keySpecs.map((s) => [s.label, s.value])).toEqual([
      ["Processor", "Halden H7 Pro"],
      ["RAM", "32 GB"],
      ["Storage", "1 TB"],
      ["Screen size", "14.2″"],
    ]);
    expect(vanta).toMatchObject({
      isDemo: true,
      verificationStatus: "verified",
      href: "/products/halden/vanta-14-2026",
    });
  });
});

describe("offers in listings (market rules)", () => {
  it("lowest price uses only fresh, in-stock offers in the market; stale/expired/out-of-stock never count", async () => {
    const ids = Object.fromEntries(
      (await db().select({ id: products.id, slug: products.slug }).from(products)).map((p) => [
        p.slug,
        p.id,
      ]),
    );
    const pl = await getLowestFreshOffers(
      db(),
      [ids["aera-7-pro"]!, ids["vanta-14-2026"]!, ids["pocket-3"]!],
      "PL",
      72,
    );
    // Aera PL: refurbished 3349 (fresh), new 3899 (fresh), 4449 out of stock, 4299 stale (5 days).
    expect(pl.get(ids["aera-7-pro"]!)).toMatchObject({
      price: "3349.0000",
      currency: "PLN",
      offerCount: 3,
    });
    expect(pl.get(ids["pocket-3"]!)).toBeUndefined();
    // ALL: counts across markets, never a cross-currency price; the expired US Vanta offer is excluded.
    const all = await getLowestFreshOffers(db(), [ids["vanta-14-2026"]!], "ALL", 72);
    expect(all.get(ids["vanta-14-2026"]!)).toMatchObject({
      price: null,
      currency: null,
      offerCount: 3,
      marketCount: 2,
    });
  });

  it("price filter and price sort apply only with a single-currency market", async () => {
    expect(await getMarketCurrencies(db(), "PL")).toEqual(["PLN"]);
    expect(await getMarketCurrencies(db(), "ALL")).toEqual([]);
    const filtered = await list("smartphones", { "price.max": "3500" }, PL);
    expect(filtered.slugs).toEqual(["aera-7-pro"]);
    // Ignored for ALL (no conversion between currencies).
    expect((await list("smartphones", { "price.max": "3500" }, ALL)).total).toBe(4);
    const sorted = await listCatalog(db(), {}, parseCatalogFilters({ sort: "price_asc" }), PL);
    const priced = sorted.items.filter((i) => i.offer?.price);
    expect(priced.map((i) => i.slug)).toEqual(["hush-5", "x9-3d", "aera-7-pro", "vanta-14-2026"]);
    expect(sorted.items.slice(0, priced.length).map((i) => i.slug)).toEqual(
      priced.map((i) => i.slug),
    ); // unpriced last
  });

  it("lists markets from offers and retailers", async () => {
    expect(await listMarkets(db())).toEqual(["DE", "PL", "US"]);
  });
});

describe("search", () => {
  const search = (q: string) => new PostgresSearchService(db()).search(q, { ...ALL, page: 1 });

  it("puts an exact model-number match first", async () => {
    const r = await search("na7p-2611");
    expect(r.products[0]).toMatchObject({ slug: "aera-7-pro", exact: true });
  });

  it("matches a variant GTIN exactly and links to that variant", async () => {
    const [v] = await db().execute<{ gtin: string }>(
      sql`SELECT barcode_gtin AS gtin FROM product_variants WHERE variant_code = '1tb-us'`,
    );
    const r = await search(v!.gtin);
    expect(r.products[0]).toMatchObject({
      slug: "aera-7-pro",
      exact: true,
      matchedVariantCode: "1tb-us",
      href: "/products/novik/aera-7-pro?variant=1tb-us",
    });
  });

  it("finds by name prefix, by brand and fuzzily", async () => {
    expect((await search("aera")).products.map((p) => p.slug).sort()).toEqual([
      "aera-6-pro",
      "aera-7-pro",
    ]);
    expect((await search("hush 5")).products[0]?.slug).toBe("hush-5");
    expect((await search("aeara")).products.map((p) => p.slug)).toEqual(
      expect.arrayContaining(["aera-7-pro"]),
    );
    const brand = await search("halden");
    expect(brand.brands[0]).toMatchObject({ slug: "halden" });
    expect(brand.products.length).toBeGreaterThan(3);
  });

  it("returns categories as their own group", async () => {
    const r = await search("monitor");
    expect(r.categories.map((c) => c.slug)).toContain("monitors");
  });

  it("offers spelling alternatives when nothing matches", async () => {
    const r = await search("Hushh Five");
    expect(r.products.length + r.didYouMean.length).toBeGreaterThan(0);
    const none = await search("zzzzqqq");
    expect(none).toMatchObject({ total: 0, products: [], brands: [] });
  });

  it("suggest returns at most 8 products plus brand/category groups", async () => {
    const s = await new PostgresSearchService(db()).suggest("halden");
    expect(s.products.length).toBeLessThanOrEqual(8);
    expect(s.brands).toEqual([{ name: "Halden", href: "/brands/halden" }]);
    expect((await new PostgresSearchService(db()).suggest("a")).products).toEqual([]);
  });

  it("never returns drafts", async () => {
    const [b] = await db().select().from(brands).where(eq(brands.slug, "halden"));
    const [c] = await db().execute<{ id: string }>(
      sql`SELECT id FROM categories WHERE slug = 'laptops'`,
    );
    await createProduct(ctx(), {
      brandId: b!.id,
      categoryId: c!.id,
      name: "Secret Draft Laptop",
      modelNumber: "DRAFT-1",
    });
    expect((await search("DRAFT-1")).total).toBe(0);
    expect((await search("secret draft")).total).toBe(0);
  });
});

describe("product page", () => {
  it("loads specs grouped with Not available rows and derived predecessor", async () => {
    const r = await loadProductPage(db(), "corvala", "strand-s");
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    const rows = r.data.specGroups.flatMap((g) => g.rows);
    expect(rows.find((x) => x.key === "ram")?.value).toBeNull();
    expect(rows.find((x) => x.key === "storage")?.value).toBe("256 GB");
    expect(r.data.requiredCoverage).toEqual({ present: 4, required: 5 }); // RAM missing

    const aera = await loadProductPage(db(), "novik", "aera-7-pro");
    if (aera.kind !== "ok") throw new Error("expected ok");
    expect(aera.data.predecessors.map((p) => p.slug)).toEqual(["aera-6-pro"]);
    expect(aera.data.sources.map((s) => s.name)).toEqual(["Specbase demonstration research"]);
    const six = await loadProductPage(db(), "novik", "aera-6-pro");
    if (six.kind !== "ok") throw new Error("expected ok");
    expect(six.data.successors.map((p) => p.slug)).toEqual(["aera-7-pro"]);
  });

  it("applies the selected variant's overrides and ignores unknown variant codes", async () => {
    const r = await loadProductPage(db(), "novik", "aera-7-pro", "1tb-us");
    if (r.kind !== "ok") throw new Error("expected ok");
    const rows = r.data.specGroups.flatMap((g) => g.rows);
    expect(rows.find((x) => x.key === "storage")).toMatchObject({
      value: "1 TB",
      isVariantOverride: true,
    });
    expect(rows.find((x) => x.key === "ram")).toMatchObject({
      value: "16 GB",
      isVariantOverride: true,
    });
    const bogus = await loadProductPage(db(), "novik", "aera-7-pro", "nope");
    if (bogus.kind !== "ok") throw new Error("expected ok");
    expect(bogus.data.selectedVariant).toBeNull();
  });

  it("redirects a wrong brand slug, follows old slugs, and 404s drafts", async () => {
    expect(await loadProductPage(db(), "halden", "aera-7-pro", "512gb-eu")).toEqual({
      kind: "redirect",
      to: "/products/novik/aera-7-pro?variant=512gb-eu",
    });
    const [p] = await db().select().from(products).where(eq(products.slug, "pocket-3"));
    await updateProduct(ctx(), p!.id, { slug: "pocket-3-compact" });
    expect(await loadProductPage(db(), "halden", "pocket-3")).toEqual({
      kind: "redirect",
      to: "/products/halden/pocket-3-compact",
    });
    const [draft] = await db()
      .select()
      .from(products)
      .where(eq(products.slug, "secret-draft-laptop"));
    expect(await loadProductPage(db(), "halden", draft!.slug)).toEqual({ kind: "not_found" });
    await publishProduct(ctx(), draft!.id);
    expect((await loadProductPage(db(), "halden", draft!.slug)).kind).toBe("ok");
  });
});

describe("navigation, brands and markets", () => {
  it("builds the category tree with subtree counts", async () => {
    const tree = await getCategoryTree(db());
    const laptops = tree.find((c) => c.slug === "laptops")!;
    expect(laptops.children.map((c) => c.slug)).toEqual(["gaming-laptops"]);
    expect(laptops.productCount).toBeGreaterThanOrEqual(5);
    expect(tree.map((c) => c.slug)).not.toContain("gaming-laptops");
  });

  it("orders brands by product count and loads brand pages", async () => {
    const list = await listBrandsByProductCount(db());
    const counts = list.map((b) => b.productCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const page = await getBrandPageData(db(), "halden");
    if (page.kind !== "ok") throw new Error("expected ok");
    expect(page.data.discontinuedIds.length).toBe(1); // Vanta 14 (2025)
    expect(page.data.families.map((f) => f.slug)).toContain("vanta");
    expect(await getBrandPageData(db(), "nobody")).toEqual({ kind: "not_found" });
  });

  it("hides expired offers from the market list inputs", async () => {
    await db().update(retailerOffers).set({ isActive: false });
    // Retailers still define markets even with no active offers.
    expect(await listMarkets(db())).toEqual(["DE", "PL", "US"]);
    await db().update(retailerOffers).set({ isActive: true });
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per fixed window, then blocks", async () => {
    let t = new Date("2026-11-19T12:00:10Z");
    const limiter = new PostgresRateLimiter(db(), () => t);
    const key = rateLimitKey("test", "203.0.113.7");
    expect(key).not.toContain("203.0.113.7");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.consume(key, 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.resetAt.toISOString()).toBe("2026-11-19T12:01:00.000Z");
    t = new Date("2026-11-19T12:01:05Z");
    expect((await limiter.consume(key, 3, 60)).allowed).toBe(true);
  });
});
