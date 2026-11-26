import { createHash } from "node:crypto";
import { z } from "zod";
import type { Env } from "@/config/env";
import { missingProviderConfig } from "../core/config";
import { ProviderHttpError } from "../core/http";
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderFeature,
  ProviderHealth,
  ProviderRecord,
} from "../core/types";

/**
 * Open Icecat (free) — Product JSON adapter (DECISIONS D81).
 *
 * Checked on 2026-11-26 against Icecat's "Manual for Channel Partners: Icecat Product JSON"
 * (v3.1, updated 2026-11-17, https://iceclog.com/manual-for-icecat-json-product-requests/), the
 * Open Content License v1.4 (2026-02-11) and the Open Icecat Fair Use Policy (2026-05-02).
 *
 * - One product per GET request, identified by GTIN or Icecat product ID; there is no search
 *   endpoint (discovery would need the XML index files, which this adapter does not use).
 * - Bulk/server-side requests go to live-origin.icecat.biz: the CDN host (live.icecat.biz) may
 *   silently drop high volume from one address (manual §4).
 * - Authentication: the `api-token` header when configured (then no user name is sent),
 *   otherwise `shopname` = the free Open Icecat user name. The public demo account is refused.
 * - The content token is never sent: Icecat appends it to file links, which would put a secret
 *   into stored URLs, and this adapter does not download files.
 * - Images are not imported: Icecat asks partners to download and host files themselves and not
 *   to link to Icecat file links (manual §3), and re-hosting is not built (licensing.md).
 * - Full Icecat products (error 9) are refused by Icecat for free accounts and are never
 *   requested another way.
 */

export const ICECAT_API_HOST = "live-origin.icecat.biz";
const ENDPOINT = `https://${ICECAT_API_HOST}/api`;
/** Granular call: only the sections the import uses (manual §5). */
const CONTENT = "generalinfo,featuregroups,catalogobjectcloud";
/** Product used by the connection test: the example product of Icecat's own JSON manual. */
export const ICECAT_HEALTH_PRODUCT_ID = "56195846";
/**
 * Fair Use Policy: at most 1 million data-sheet downloads per month (per country/language
 * repository). Daily UTC windows of 30,000 keep any calendar month below 930,000.
 */
export const ICECAT_DAILY_LIMIT = 30_000;

/** Icecat error codes (manual §9) the adapter treats as "no such product". */
const NOT_FOUND_CODES = new Set([8, 16, 17]);
/** Products Icecat refuses for this account; the message names the reason. */
const NOT_AVAILABLE: Record<number, string> = {
  9: "not part of Open Icecat (Full Icecat only); free accounts cannot receive it",
  12: "outside the account's Icecat verticals",
  14: "restricted by the brand, or not public in this language",
  15: "data sheet not released yet",
};
/** Codes that mean the account settings are wrong (no retry helps). */
const CONFIG_ERRORS: Record<number, string> = {
  1: "lang and user name (or API token) are required",
  2: "unknown language code (ICECAT_DEFAULT_LANG)",
  3: "unknown Icecat user, or not a Channel Partner account (ICECAT_USERNAME)",
  18: "no account found for the API token (ICECAT_API_TOKEN; is it the content token?)",
  19: "the API token is not a valid UUID (ICECAT_API_TOKEN)",
};

const str = z.union([z.string(), z.number()]).transform(String);
const localized = z.object({ Value: z.string().optional() }).partial().optional().catch(undefined);

const featureSchema = z.object({
  Value: str.optional(),
  RawValue: str.optional(),
  Feature: z.object({
    ID: str,
    Name: localized,
    Measure: z
      .object({ Signs: z.object({ _: z.string().optional() }).optional().catch(undefined) })
      .optional()
      .catch(undefined),
  }),
});

const dataSchema = z.object({
  GeneralInfo: z.object({
    IcecatId: str,
    Title: z.string().optional(),
    TitleInfo: z
      .object({ GeneratedIntTitle: z.string().optional(), GeneratedLocalTitle: localized })
      .optional()
      .catch(undefined),
    Brand: z.string().optional(),
    BrandPartCode: z.string().optional(),
    GTIN: z.array(str).optional().catch(undefined),
    Category: z.object({ CategoryID: str.optional(), Name: localized }).optional().catch(undefined),
    ProductFamily: localized,
    ReleaseDate: z.string().optional(),
    Description: z
      .object({ LongDesc: z.string().optional(), MiddleDesc: z.string().optional() })
      .optional()
      .catch(undefined),
  }),
  FeaturesGroups: z
    .array(
      z.object({
        FeatureGroup: z.object({ Name: localized }).optional().catch(undefined),
        Features: z.array(featureSchema).optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
  CatalogObjectCloud: z
    .object({ ProductPage: z.object({ URL: z.string().optional() }).optional() })
    .optional()
    .catch(undefined),
  DemoAccount: z.boolean().optional(),
});
type IcecatData = z.infer<typeof dataSchema>;

const responseSchema = z.object({ msg: z.string().optional(), data: z.unknown().optional() });
const errorSchema = z.object({
  StatusCode: z.coerce.number().int().optional(),
  Code: z.coerce.number().int().optional(),
  Message: z.string().optional(),
});

const fail = (message: string, status: number | null, retryable = false) =>
  new ProviderHttpError("icecat", message, status, retryable);

const blank = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};

/** DD-MM-YYYY (manual §6.2) → YYYY-MM-DD; anything else is passed on as returned. */
export function icecatDate(raw: string | null | undefined): string | null {
  const v = blank(raw);
  if (!v) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

function features(data: IcecatData): ProviderFeature[] {
  const out: ProviderFeature[] = [];
  for (const group of data.FeaturesGroups ?? []) {
    for (const f of group.Features ?? []) {
      // RawValue is the value for comparison (manual §6.6); PresentationValue is display text.
      const value = f.RawValue ?? f.Value ?? "";
      if (!value.trim()) continue;
      out.push({
        externalId: f.Feature.ID,
        name: blank(f.Feature.Name?.Value) ?? f.Feature.ID,
        value,
        // Feature.Sign and Measure.Sign are always empty; the unit is Measure.Signs._.
        unit: blank(f.Feature.Measure?.Signs?._),
        group: blank(group.FeatureGroup?.Name?.Value),
      });
    }
  }
  return out;
}

/** Product JSON `data` → ProviderRecord. Values are kept as Icecat returned them. */
export function icecatRecord(data: IcecatData, payloadHash: string, now: Date): ProviderRecord {
  const g = data.GeneralInfo;
  const page = blank(data.CatalogObjectCloud?.ProductPage?.URL);
  return {
    provider: "icecat",
    providerProductId: g.IcecatId,
    url: page && /^https:\/\//i.test(page) ? page : null,
    brand: blank(g.Brand),
    name:
      blank(g.TitleInfo?.GeneratedLocalTitle?.Value) ??
      blank(g.TitleInfo?.GeneratedIntTitle) ??
      blank(g.Title),
    // Icecat has no separate model-number field; ProductName is a name, not a model number.
    modelNumber: null,
    mpn: blank(g.BrandPartCode),
    // GTIN holds confirmed GTINs only (manual §6.2).
    gtins: (g.GTIN ?? []).map((x) => x.trim()).filter(Boolean),
    categoryExternalId: blank(g.Category?.CategoryID),
    categoryName: blank(g.Category?.Name?.Value),
    family: blank(g.ProductFamily?.Value),
    releaseDate: icecatDate(g.ReleaseDate),
    description: blank(g.Description?.LongDesc) ?? blank(g.Description?.MiddleDesc),
    features: features(data),
    images: [],
    // Product JSON carries no quality marker.
    quality: null,
    retrievedAt: now,
    payloadHash,
  };
}

/**
 * Interprets one Product JSON response: a record, `null` for "no such product", or an error
 * (non-retryable for refusals and configuration problems; HTTP 5xx is retried by the client).
 */
export function parseIcecatResponse(
  status: number,
  body: string,
  now: Date = new Date(),
): ProviderRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw fail(`HTTP ${status}: response is not JSON`, status);
  }
  const err = errorSchema.safeParse(json);
  const code = err.success ? err.data.StatusCode : undefined;
  if (code !== undefined || status >= 400) {
    if (code !== undefined && NOT_FOUND_CODES.has(code)) return null;
    if (code === undefined && status === 404) return null;
    if (code !== undefined && NOT_AVAILABLE[code])
      throw fail(`product ${NOT_AVAILABLE[code]} (Icecat error ${code})`, status);
    if (code !== undefined && CONFIG_ERRORS[code])
      throw fail(`configuration: ${CONFIG_ERRORS[code]} (Icecat error ${code})`, status);
    throw fail(
      `request refused (HTTP ${status}${code !== undefined ? `, Icecat error ${code}` : ""})`,
      status,
    );
  }
  const envelope = responseSchema.safeParse(json);
  if (!envelope.success || envelope.data.msg !== "OK")
    throw fail(`unexpected response (msg is not OK)`, status);
  const data = dataSchema.safeParse(envelope.data.data);
  if (!data.success) throw fail("unexpected response shape (GeneralInfo missing)", status);
  if (data.data.DemoAccount)
    throw fail(
      "configuration: Icecat answered as the public demo account; set your own free Open Icecat user name or API token",
      status,
    );
  return icecatRecord(data.data, createHash("sha256").update(body).digest("hex"), now);
}

export function createIcecatAdapter(env: Env, now: Date = new Date()): ProviderAdapter {
  const cacheTtlSeconds = 86_400;
  // OCL §1 notice; the adapter is created per worker run / admin request, so the year is the
  // year of retrieval for the source records written with it.
  const year = now.getUTCFullYear();

  function url(params: Record<string, string>): string {
    const q = new URLSearchParams({ lang: env.ICECAT_DEFAULT_LANG.toUpperCase() });
    // With an API token the account is identified by the header, and shopname must be left out.
    if (!env.ICECAT_API_TOKEN && env.ICECAT_USERNAME) q.set("shopname", env.ICECAT_USERNAME);
    for (const [k, v] of Object.entries(params)) q.set(k, v);
    return `${ENDPOINT}?${q.toString()}`;
  }

  async function get(params: Record<string, string>, ctx: ProviderContext, cache = true) {
    const res = await ctx.http.request(url(params), {
      headers: env.ICECAT_API_TOKEN ? { "api-token": env.ICECAT_API_TOKEN } : {},
      cacheTtlSeconds: cache ? cacheTtlSeconds : undefined,
    });
    return parseIcecatResponse(res.status, res.body);
  }

  return {
    key: "icecat",
    displayName: "Open Icecat (free)",
    capabilities: {
      lookupByGtin: true,
      search: false,
      fetchById: true,
      specs: true,
      images: false,
      offers: false,
    },
    licence: {
      name: "Open Content License (Open Icecat) v1.4",
      url: "https://iceclog.com/open-content-license/",
      usage: "store",
      attributionRequired: true,
      attribution:
        `Database Right data-sheet ${year} Icecat. All rights reserved. Open Icecat content is provided ` +
        "“as is”, without warranty of any kind, under the Open Content License.",
      imageLicence: "none",
      unverified: false,
    },
    quotas: [{ bucket: "datasheets", limit: ICECAT_DAILY_LIMIT, windowSeconds: 86_400 }],
    allowedHosts: [ICECAT_API_HOST],
    // Not documented by Icecat; our own spacing to stay well inside fair use.
    minIntervalMs: 200,
    secretParams: ["shopname"],
    cacheTtlSeconds,
    missingConfig: (e) => missingProviderConfig("icecat", e),

    async healthCheck(ctx): Promise<ProviderHealth> {
      const checkedAt = new Date();
      try {
        const r = await get(
          { icecat_id: ICECAT_HEALTH_PRODUCT_ID, content: "generalinfo" },
          ctx,
          false,
        );
        return r
          ? { status: "ok", message: null, checkedAt }
          : { status: "degraded", message: "Test product not found", checkedAt };
      } catch (e) {
        if (e instanceof ProviderHttpError && !e.message.includes("configuration:"))
          return { status: "degraded", message: e.message, checkedAt };
        return { status: "error", message: e instanceof Error ? e.message : String(e), checkedAt };
      }
    },

    async lookupByGtin(gtin14, ctx) {
      const r = await get({ GTIN: gtin14, content: CONTENT }, ctx);
      return r ? [r] : [];
    },

    async fetchById(id, ctx) {
      if (!/^\d{1,12}$/.test(id))
        throw fail(`"${id}" is not an Icecat product ID (digits only)`, null);
      return get({ icecat_id: id, content: CONTENT }, ctx);
    },
  };
}
