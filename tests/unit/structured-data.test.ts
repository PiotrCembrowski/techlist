import { describe, expect, it } from "vitest";
import type { DisplayOffer } from "@/modules/offers/display";
import {
  articleJsonLd,
  breadcrumbList,
  organizationAndWebsite,
  productJsonLd,
  serializeJsonLd,
  structuredOffers,
} from "@/modules/seo/structured-data";

const SITE = "https://specs.example";
const now = new Date("2026-11-20T12:00:00Z");
const offer = (o: Partial<DisplayOffer>): DisplayOffer => ({
  id: "o",
  retailerName: "Shop",
  retailerSlug: "shop",
  marketCountryCode: "DE",
  currency: "EUR",
  priceAmount: "999.0000",
  originalPriceAmount: null,
  shippingCost: null,
  availabilityStatus: "in_stock",
  condition: "new",
  lastCheckedAt: new Date("2026-11-20T08:00:00Z"),
  expiresAt: null,
  isActive: true,
  isDemo: false,
  variantId: null,
  variantName: null,
  ...o,
});

describe("serializeJsonLd", () => {
  it("cannot close the script element or break parsing", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script> & \u2028" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).not.toContain("\u2028");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script> & \u2028" });
  });
});

describe("structured offers", () => {
  it("keeps only fresh, non-demo offers in the selected market", () => {
    const offers = [
      offer({ id: "ok" }),
      offer({ id: "demo", isDemo: true }),
      offer({ id: "pl", marketCountryCode: "PL" }),
      offer({ id: "stale", lastCheckedAt: new Date("2026-11-10T00:00:00Z") }),
      offer({ id: "expired", expiresAt: new Date("2026-11-19T00:00:00Z") }),
      offer({ id: "inactive", isActive: false }),
    ];
    expect(structuredOffers(offers, "DE", 72, now).map((o) => o.id)).toEqual(["ok"]);
    expect(structuredOffers(offers, "ALL", 72, now)).toEqual([]);
  });
});

describe("builders", () => {
  it("homepage: Organization and WebSite with a SearchAction", () => {
    const ld = organizationAndWebsite(SITE) as {
      "@graph": { "@type": string; potentialAction?: { target: { urlTemplate: string } } }[];
    };
    expect(ld["@graph"].map((n) => n["@type"])).toEqual(["Organization", "WebSite"]);
    expect(ld["@graph"][1]!.potentialAction!.target.urlTemplate).toBe(
      "https://specs.example/search?q={search_term_string}",
    );
  });
  it("breadcrumbs use absolute URLs and positions", () => {
    const ld = breadcrumbList(
      SITE,
      [
        { label: "Home", href: "/" },
        { label: "Laptops", href: "/categories/laptops" },
        { label: "X" },
      ],
      "/products/a/x",
    ) as {
      itemListElement: { position: number; item: string }[];
    };
    expect(ld.itemListElement.map((i) => [i.position, i.item])).toEqual([
      [1, "https://specs.example/"],
      [2, "https://specs.example/categories/laptops"],
      [3, "https://specs.example/products/a/x"],
    ]);
  });
  it("product with offers, never ratings or reviews", () => {
    const ld = productJsonLd(SITE, {
      path: "/products/novik/kestrel-14",
      name: "Kestrel 14",
      brand: "Novik",
      description: "A laptop.",
      modelNumber: "NK14",
      mpn: null,
      releaseDate: "2026-09-01",
      category: "Laptops",
      image: "/media/products/x.jpg",
      specs: [{ label: "RAM", value: "16 GB" }],
      offers: [offer({})],
    });
    expect(ld).toMatchObject({
      "@type": "Product",
      name: "Novik Kestrel 14",
      model: "NK14",
      image: "https://specs.example/media/products/x.jpg",
      offers: [
        {
          "@type": "Offer",
          price: "999.00",
          priceCurrency: "EUR",
          availability: "https://schema.org/InStock",
        },
      ],
    });
    const json = serializeJsonLd(ld);
    expect(json).not.toMatch(/Review|AggregateRating|ratingValue/);
    expect(
      productJsonLd(SITE, {
        path: "/p",
        name: "n",
        brand: "b",
        description: null,
        modelNumber: null,
        mpn: null,
        releaseDate: null,
        category: null,
        image: null,
        specs: [],
        offers: [],
      }),
    ).not.toHaveProperty("offers");
  });
  it("guides are Articles", () => {
    expect(
      articleJsonLd(SITE, {
        path: "/guides/g",
        title: "T",
        description: null,
        publishedAt: now,
        updatedAt: null,
      }),
    ).toMatchObject({
      "@type": "Article",
      headline: "T",
      datePublished: now.toISOString(),
    });
  });
});
