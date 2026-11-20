import { sql } from "drizzle-orm";
import { z } from "zod";
import type { retailerOffers, sources } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import type { ServiceContext } from "@/modules/_shared/context";
import { validateRedirectTarget } from "@/modules/offers/redirect";
import {
  createRetailerOffer,
  offerBaseSchema,
  updateRetailerOffer,
} from "@/modules/offers/service";
import type { RowIssue, RowPlan } from "./types";

type Source = typeof sources.$inferSelect;
type Offer = typeof retailerOffers.$inferSelect;

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const isoDateTime = z
  .string()
  .trim()
  .transform((v) => v || null)
  .refine(
    (v) =>
      v === null ||
      (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
        !Number.isNaN(new Date(v).getTime())),
    "Use an ISO date or date-time",
  );

const rowSchema = z.object({
  retailer_slug: z.string().trim().toLowerCase().min(1, "Required"),
  brand: opt(120),
  product_model_number: opt(80),
  gtin: opt(14),
  variant_code: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v || null),
  market_country_code: z.string().trim().toUpperCase(),
  currency: z.string().trim().toUpperCase(),
  price: z.string().trim(),
  original_price: opt(30),
  shipping_cost: opt(30),
  condition: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v || "new"),
  availability: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/\s+/g, "_") || "unknown"),
  product_url: z.string().trim(),
  affiliate_url: opt(2000),
  last_checked_at: isoDateTime,
  expires_at: isoDateTime,
  is_demo: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => ["", "true", "false", "yes", "no", "1", "0"].includes(v), "Use true or false")
    .transform((v) => (v === "" ? null : ["true", "yes", "1"].includes(v))),
});

export type OfferRowData = z.output<typeof rowSchema>;

export function parseOfferRow(mapped: Record<string, string>): {
  data: OfferRowData | null;
  issues: RowIssue[];
} {
  const filled = Object.fromEntries(rowSchema.keyof().options.map((k) => [k, mapped[k] ?? ""]));
  const r = rowSchema.safeParse(filled);
  if (!r.success)
    return {
      data: null,
      issues: r.error.issues.map((i) => ({ field: String(i.path[0]), message: i.message })),
    };
  if (!r.data.product_model_number && !r.data.gtin) {
    return {
      data: null,
      issues: [{ field: "product_model_number", message: "Give a model number or a GTIN" }],
    };
  }
  return { data: r.data, issues: [] };
}

export interface OfferRowPlan extends RowPlan {
  data: OfferRowData | null;
  offerId: string | null;
  /** Values for createRetailerOffer / updateRetailerOffer. */
  values: Record<string, unknown> | null;
}

/** Column name in the file for each offer field (for error messages). */
const FIELD_COLUMN: Record<string, string> = {
  marketCountryCode: "market_country_code",
  priceAmount: "price",
  originalPriceAmount: "original_price",
  shippingCost: "shipping_cost",
  availabilityStatus: "availability",
  productUrl: "product_url",
  affiliateUrl: "affiliate_url",
  lastCheckedAt: "last_checked_at",
  expiresAt: "expires_at",
};

const arr = <T>(xs: T[], type: string) => sql`${sql.param(xs)}::${sql.raw(type)}[]`;
const uniq = <T>(xs: T[]) => [...new Set(xs)];

function sameMoney(a: string | null, b: unknown) {
  if (a === null || b === null || b === undefined) return a === (b ?? null);
  return Number(a) === Number(b);
}

export async function planOfferRows(
  db: DbOrTx,
  input: { rowNumber: number; hash: string; data: OfferRowData | null; issues: RowIssue[] }[],
  jobSource: Source,
): Promise<OfferRowPlan[]> {
  const rows = input.filter((r): r is typeof r & { data: OfferRowData } => r.data !== null);
  const slugs = uniq(rows.map((r) => r.data.retailer_slug));
  const gtins = uniq(rows.map((r) => r.data.gtin).filter((g): g is string => !!g));
  const models = uniq(
    rows.map((r) => r.data.product_model_number?.toLowerCase()).filter((m): m is string => !!m),
  );

  const [retailerRows, gtinRows, modelRows] = await Promise.all([
    db.execute<{
      id: string;
      slug: string;
      supported_currencies: string[];
      allowed_redirect_hosts: string[];
      is_demo: boolean;
    }>(sql`
      SELECT id, slug, supported_currencies, allowed_redirect_hosts, is_demo FROM retailers WHERE slug = ANY(${arr(slugs, "text")})`),
    gtins.length
      ? db.execute<{
          gtin: string;
          product_id: string;
          variant_id: string;
          variant_code: string;
        }>(sql`
          SELECT barcode_gtin AS gtin, product_id, id AS variant_id, variant_code FROM product_variants WHERE barcode_gtin = ANY(${arr(gtins, "text")})`)
      : Promise.resolve([]),
    models.length
      ? db.execute<{
          model: string;
          product_id: string;
          brand_name: string;
          brand_slug: string;
        }>(sql`
          SELECT lower(p.model_number) AS model, p.id AS product_id, b.name AS brand_name, b.slug AS brand_slug
          FROM products p JOIN brands b ON b.id = p.brand_id WHERE lower(p.model_number) = ANY(${arr(models, "text")})`)
      : Promise.resolve([]),
  ]);
  const retailers = new Map(retailerRows.map((r) => [r.slug, r]));
  const byGtin = new Map(gtinRows.map((g) => [g.gtin, g]));
  const productIds = uniq([
    ...gtinRows.map((g) => g.product_id),
    ...modelRows.map((m) => m.product_id),
  ]);
  const [variantRows, offerRows] = productIds.length
    ? await Promise.all([
        db.execute<{ id: string; product_id: string; variant_code: string }>(sql`
          SELECT id, product_id, variant_code FROM product_variants WHERE product_id = ANY(${arr(productIds, "uuid")})`),
        db.execute<Record<string, unknown>>(sql`
          SELECT id, retailer_id, product_id, variant_id, market_country_code, condition, currency, price_amount::text, original_price_amount::text,
                 shipping_cost::text, availability_status, product_url, affiliate_url, retailer_product_id, last_checked_at, expires_at, is_active, is_demo, source_id
          FROM retailer_offers WHERE product_id = ANY(${arr(productIds, "uuid")})`),
      ])
    : [[], []];

  const seen = new Map<string, number>();
  return input.map((r) => {
    const plan: OfferRowPlan = {
      action: "error",
      issues: [...r.issues],
      notes: [],
      data: r.data,
      offerId: null,
      values: null,
    };
    if (!r.data) return plan;
    const d = r.data;
    if (seen.has(r.hash)) {
      plan.action = "skip";
      plan.notes.push(`Same as row ${seen.get(r.hash)}`);
      return plan;
    }
    seen.set(r.hash, r.rowNumber);

    const retailer = retailers.get(d.retailer_slug);
    if (!retailer)
      plan.issues.push({
        field: "retailer_slug",
        message: `Unknown retailer "${d.retailer_slug}"`,
      });

    let productId: string | null = null;
    let variantId: string | null = null;
    if (d.gtin) {
      const g = byGtin.get(d.gtin);
      if (!g) plan.issues.push({ field: "gtin", message: "No variant has this GTIN" });
      else {
        productId = g.product_id;
        variantId = g.variant_id;
        if (d.variant_code && d.variant_code !== g.variant_code)
          plan.issues.push({
            field: "variant_code",
            message: `The GTIN belongs to variant ${g.variant_code}`,
          });
      }
    }
    if (d.product_model_number) {
      const hits = modelRows.filter(
        (m) =>
          m.model === d.product_model_number!.toLowerCase() &&
          (!d.brand ||
            m.brand_slug === d.brand.toLowerCase() ||
            m.brand_name.toLowerCase() === d.brand.toLowerCase()),
      );
      if (hits.length === 0)
        plan.issues.push({
          field: "product_model_number",
          message: "No product has this model number",
        });
      else if (hits.length > 1)
        plan.issues.push({
          field: "product_model_number",
          message: "Several brands use this model number — add a brand column",
        });
      else if (productId && hits[0]!.product_id !== productId)
        plan.issues.push({
          field: "gtin",
          message: "GTIN and model number point to different products",
        });
      else productId = hits[0]!.product_id;
    }
    if (productId && !variantId && d.variant_code) {
      const v = variantRows.find(
        (x) => x.product_id === productId && x.variant_code === d.variant_code,
      );
      if (!v)
        plan.issues.push({
          field: "variant_code",
          message: `The product has no variant "${d.variant_code}"`,
        });
      else variantId = v.id;
    }
    if (plan.issues.length || !retailer || !productId) {
      plan.action = "error";
      return plan;
    }

    const values = {
      productId,
      retailerId: retailer.id,
      variantId,
      marketCountryCode: d.market_country_code,
      productUrl: d.product_url,
      affiliateUrl: d.affiliate_url,
      currency: d.currency,
      priceAmount: d.price,
      originalPriceAmount: d.original_price,
      shippingCost: d.shipping_cost,
      availabilityStatus: d.availability,
      condition: d.condition,
      sourceId: jobSource.id,
      ...(d.last_checked_at ? { lastCheckedAt: d.last_checked_at } : {}),
      expiresAt: d.expires_at,
      isDemo: d.is_demo ?? retailer.is_demo,
    };
    // Same rules as the offer service: schema, currency, redirect hosts.
    const parsed = offerBaseSchema.safeParse(values);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const f = String(i.path[0] ?? "");
        plan.issues.push({ field: FIELD_COLUMN[f] ?? f, message: i.message });
      }
      return plan;
    }
    if (!retailer.supported_currencies.includes(d.currency)) {
      plan.issues.push({
        field: "currency",
        message: `${retailer.slug} does not sell in ${d.currency}`,
      });
    }
    for (const [col, url] of [
      ["product_url", d.product_url],
      ["affiliate_url", d.affiliate_url],
    ] as const) {
      if (url && !validateRedirectTarget(url, retailer.allowed_redirect_hosts).ok) {
        plan.issues.push({
          field: col,
          message: "The URL's host is not one of the retailer's allowed redirect hosts",
        });
      }
    }
    if (plan.issues.length) return plan;

    const p = parsed.data;
    const existing = offerRows.find(
      (o) =>
        o.retailer_id === retailer.id &&
        o.product_id === productId &&
        (o.variant_id ?? null) === variantId &&
        o.market_country_code === p.marketCountryCode &&
        o.condition === p.condition,
    ) as (Record<string, unknown> & { id: string }) | undefined;
    plan.values = values;
    if (!existing) {
      plan.action = "create";
      plan.notes.push("New offer");
      return plan;
    }
    plan.offerId = existing.id;
    const time = (v: unknown) => (v ? new Date(v as string).getTime() : null);
    const changed: string[] = [];
    if (existing.currency !== p.currency) changed.push("currency");
    if (!sameMoney(p.priceAmount, existing.price_amount)) changed.push("price");
    if (!sameMoney(p.originalPriceAmount, existing.original_price_amount))
      changed.push("original price");
    if (!sameMoney(p.shippingCost, existing.shipping_cost)) changed.push("shipping");
    if (existing.availability_status !== p.availabilityStatus) changed.push("availability");
    if (existing.product_url !== p.productUrl) changed.push("product URL");
    if ((existing.affiliate_url ?? null) !== p.affiliateUrl) changed.push("affiliate URL");
    if (time(existing.expires_at) !== (p.expiresAt ? p.expiresAt.getTime() : null))
      changed.push("expiry");
    if (p.lastCheckedAt && time(existing.last_checked_at) !== p.lastCheckedAt.getTime())
      changed.push("last checked");
    if (existing.is_active !== true) changed.push("reactivated");
    if (existing.is_demo !== p.isDemo) changed.push("demo flag");
    if (changed.length === 0) {
      plan.action = "skip";
      plan.notes.push("No changes");
    } else {
      plan.action = "update";
      plan.notes.push(`Updates ${changed.join(", ")}`);
    }
    return plan;
  });
}

export async function applyOfferPlan(
  ctx: ServiceContext,
  p: OfferRowPlan,
): Promise<{ offer: Offer; suspicious: boolean }> {
  const v = p.values!;
  if (p.offerId) {
    const { productId: _p, retailerId: _r, ...patch } = v;
    void _p;
    void _r;
    return updateRetailerOffer(ctx, p.offerId, { ...patch, isActive: true } as never);
  }
  return createRetailerOffer(ctx, v as never);
}
