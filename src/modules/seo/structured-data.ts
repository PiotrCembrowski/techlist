import { siteConfig } from "@/config/site";
import type { DisplayOffer } from "@/modules/offers/display";
import { offerFreshness } from "@/modules/offers/freshness";

/**
 * JSON-LD builders (SPEC §12). Only facts we store; never Review or AggregateRating. Callers
 * output structured data only for indexable, non-demo pages.
 */

type Json = Record<string, unknown>;

const abs = (siteUrl: string, path: string) => new URL(path, siteUrl).toString();

/**
 * Serializes JSON-LD for a `<script type="application/ld+json">`: escapes characters that could
 * close the script element or break parsing (`<`, `>`, `&`, U+2028, U+2029).
 */
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

export function organizationAndWebsite(siteUrl: string): Json {
  const url = abs(siteUrl, "/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${url}#organization`, name: siteConfig.name, url },
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        name: siteConfig.name,
        url,
        description: siteConfig.description,
        publisher: { "@id": `${url}#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${abs(siteUrl, "/search")}?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

export function breadcrumbList(
  siteUrl: string,
  items: { label: string; href?: string }[],
  currentPath: string,
): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: abs(siteUrl, c.href ?? currentPath),
    })),
  };
}

/** Offers allowed in structured data: fresh, not demo, and in the selected (specific) market. */
export function structuredOffers(
  offers: DisplayOffer[],
  market: string,
  staleHours: number,
  now: Date,
): DisplayOffer[] {
  if (market === "ALL") return [];
  return offers.filter(
    (o) =>
      !o.isDemo && o.marketCountryCode === market && offerFreshness(o, staleHours, now) === "fresh",
  );
}

const AVAILABILITY: Record<DisplayOffer["availabilityStatus"], string | null> = {
  in_stock: "https://schema.org/InStock",
  out_of_stock: "https://schema.org/OutOfStock",
  preorder: "https://schema.org/PreOrder",
  unknown: null,
};
const CONDITION: Record<DisplayOffer["condition"], string> = {
  new: "https://schema.org/NewCondition",
  used: "https://schema.org/UsedCondition",
  refurbished: "https://schema.org/RefurbishedCondition",
};

export interface ProductLd {
  path: string;
  name: string;
  brand: string;
  description: string | null;
  modelNumber: string | null;
  mpn: string | null;
  releaseDate: string | null;
  category: string | null;
  image: string | null;
  specs: { label: string; value: string }[];
  offers: DisplayOffer[];
}

export function productJsonLd(siteUrl: string, p: ProductLd): Json {
  const url = abs(siteUrl, p.path);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    url,
    name: `${p.brand} ${p.name}`,
    brand: { "@type": "Brand", name: p.brand },
    ...(p.description ? { description: p.description } : {}),
    ...(p.modelNumber ? { model: p.modelNumber } : {}),
    ...(p.mpn ? { mpn: p.mpn } : {}),
    ...(p.releaseDate ? { releaseDate: p.releaseDate } : {}),
    ...(p.category ? { category: p.category } : {}),
    ...(p.image ? { image: abs(siteUrl, p.image) } : {}),
    ...(p.specs.length
      ? {
          additionalProperty: p.specs.map((s) => ({
            "@type": "PropertyValue",
            name: s.label,
            value: s.value,
          })),
        }
      : {}),
    ...(p.offers.length
      ? {
          offers: p.offers.map((o) => ({
            "@type": "Offer",
            price: Number(o.priceAmount).toFixed(2),
            priceCurrency: o.currency,
            itemCondition: CONDITION[o.condition],
            ...(AVAILABILITY[o.availabilityStatus]
              ? { availability: AVAILABILITY[o.availabilityStatus] }
              : {}),
            ...(o.expiresAt ? { priceValidUntil: o.expiresAt.toISOString().slice(0, 10) } : {}),
            eligibleRegion: { "@type": "Country", name: o.marketCountryCode },
            seller: { "@type": "Organization", name: o.retailerName },
            url,
          })),
        }
      : {}),
  };
}

export function articleJsonLd(
  siteUrl: string,
  g: {
    path: string;
    title: string;
    description: string | null;
    publishedAt: Date | null;
    updatedAt: Date | null;
  },
): Json {
  const url = abs(siteUrl, g.path);
  const org = { "@type": "Organization", name: siteConfig.name, url: abs(siteUrl, "/") };
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    url,
    mainEntityOfPage: url,
    headline: g.title.slice(0, 110),
    ...(g.description ? { description: g.description } : {}),
    ...(g.publishedAt ? { datePublished: g.publishedAt.toISOString() } : {}),
    ...(g.updatedAt ? { dateModified: g.updatedAt.toISOString() } : {}),
    author: org,
    publisher: org,
  };
}
