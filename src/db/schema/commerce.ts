import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { COUNTRY_CHECK, CURRENCY_CHECK, SLUG_CHECK, timestamps } from "./_shared";
import { products, productVariants, sources } from "./catalog";
import { availabilityStatus, offerCondition } from "./enums";

const money = () => numeric({ precision: 14, scale: 4 });

export const retailers = pgTable(
  "retailers",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    websiteUrl: text().notNull(),
    /** Hosts /go/[offerId] may redirect to. Affiliate network hosts must be listed explicitly. */
    allowedRedirectHosts: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    logoImageKey: text(),
    countryCode: text().notNull(),
    supportedCurrencies: text().array().notNull(),
    affiliateNetwork: text(),
    isActive: boolean().notNull().default(true),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check("retailers_slug_ck", SLUG_CHECK(t.slug)),
    check("retailers_country_ck", COUNTRY_CHECK(t.countryCode)),
    check(
      "retailers_currencies_ck",
      sql`cardinality(${t.supportedCurrencies}) > 0 AND sb_is_currency_array(${t.supportedCurrencies})`,
    ),
    check("retailers_https_ck", sql`${t.websiteUrl} ~ '^https://'`),
  ],
);

export const retailerOffers = pgTable(
  "retailer_offers",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, { onDelete: "cascade" }),
    retailerId: uuid()
      .notNull()
      .references(() => retailers.id, { onDelete: "restrict" }),
    retailerProductId: text(),
    marketCountryCode: text().notNull(),
    productUrl: text().notNull(),
    affiliateUrl: text(),
    currency: text().notNull(),
    priceAmount: money().notNull(),
    originalPriceAmount: money(),
    shippingCost: money(),
    availabilityStatus: availabilityStatus().notNull().default("unknown"),
    condition: offerCondition().notNull().default("new"),
    sourceId: uuid().references(() => sources.id, { onDelete: "set null" }),
    lastCheckedAt: timestamp({ withTimezone: true }).notNull(),
    expiresAt: timestamp({ withTimezone: true }),
    isActive: boolean().notNull().default(true),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("retailer_offers_product_market_idx").on(t.productId, t.marketCountryCode, t.isActive),
    index("retailer_offers_variant_idx").on(t.variantId),
    index("retailer_offers_last_checked_idx").on(t.lastCheckedAt),
    // Natural key used by imports and the seed: one offer per retailer listing, market and condition.
    unique("retailer_offers_natural_uq")
      .on(t.retailerId, t.productId, t.variantId, t.marketCountryCode, t.condition)
      .nullsNotDistinct(),
    check("retailer_offers_price_ck", sql`${t.priceAmount} > 0`),
    check(
      "retailer_offers_original_price_ck",
      sql`${t.originalPriceAmount} IS NULL OR ${t.originalPriceAmount} > 0`,
    ),
    check("retailer_offers_shipping_ck", sql`${t.shippingCost} IS NULL OR ${t.shippingCost} >= 0`),
    check("retailer_offers_market_ck", COUNTRY_CHECK(t.marketCountryCode)),
    check("retailer_offers_currency_ck", CURRENCY_CHECK(t.currency)),
    check("retailer_offers_product_url_ck", sql`${t.productUrl} ~ '^https://'`),
    check(
      "retailer_offers_affiliate_url_ck",
      sql`${t.affiliateUrl} IS NULL OR ${t.affiliateUrl} ~ '^https://'`,
    ),
  ],
);

/** Append-only: application code only ever inserts here. */
export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid().primaryKey().defaultRandom(),
    offerId: uuid()
      .notNull()
      .references(() => retailerOffers.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, { onDelete: "cascade" }),
    retailerId: uuid()
      .notNull()
      .references(() => retailers.id, { onDelete: "restrict" }),
    currency: text().notNull(),
    priceAmount: money().notNull(),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sourceId: uuid().references(() => sources.id, { onDelete: "set null" }),
  },
  (t) => [
    index("price_history_product_recorded_idx").on(t.productId, t.recordedAt.desc()),
    index("price_history_offer_idx").on(t.offerId, t.recordedAt.desc()),
    check("price_history_currency_ck", CURRENCY_CHECK(t.currency)),
    check("price_history_price_ck", sql`${t.priceAmount} > 0`),
  ],
);

/** No IP addresses or user agents are stored. */
export const affiliateClicks = pgTable(
  "affiliate_clicks",
  {
    id: uuid().primaryKey().defaultRandom(),
    offerId: uuid()
      .notNull()
      .references(() => retailerOffers.id, { onDelete: "cascade" }),
    clickedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    marketCountryCode: text(),
    referrerHost: text(),
    isProbableBot: boolean().notNull().default(false),
  },
  (t) => [
    index("affiliate_clicks_offer_idx").on(t.offerId, t.clickedAt.desc()),
    check(
      "affiliate_clicks_market_ck",
      sql`${t.marketCountryCode} IS NULL OR ${t.marketCountryCode} = 'ALL' OR ${COUNTRY_CHECK(t.marketCountryCode)}`,
    ),
    check(
      "affiliate_clicks_host_ck",
      sql`${t.referrerHost} IS NULL OR ${t.referrerHost} !~ '[/?#]'`,
    ),
  ],
);
