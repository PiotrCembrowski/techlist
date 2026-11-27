import { createHash } from "node:crypto";
import { z } from "zod";
import type { Env } from "@/config/env";
import { plainText } from "@/modules/import-core/identity";
import { missingProviderConfig } from "../core/config";
import { ProviderHttpError } from "../core/http";
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderFeature,
  ProviderHealth,
  ProviderImage,
  ProviderRecord,
  ProviderSearchHit,
} from "../core/types";

/**
 * Wikidata (identity, family, release date, measurements, links) + Wikimedia Commons (images with
 * per-file licences) via the MediaWiki Action API (DECISIONS D83).
 *
 * Checked on 2026-11-27 against: API:Etiquette (requests in series, maxlag, caching, descriptive
 * User-Agent), the Wikimedia Foundation API Usage Guidelines (2024-08-26) and User-Agent policy,
 * "Wikimedia APIs/Rate limits" (new in 2026: 200 requests/min for unauthenticated clients with a
 * compliant User-Agent, 10/min without contact details; at most 3 concurrent requests; honour
 * Retry-After), Manual:Maxlag parameter (errors come with HTTP 200 and Retry-After),
 * Help:Extension:WikibaseCirrusSearch (haswbstatement), Wikidata:Licensing (structured data is
 * CC0), Commons:Reusing content outside Wikimedia (+ /technical: hotlinking allowed, licence terms
 * apply per file) and Extension:CommonsMetadata (extmetadata fields). Property IDs were read from
 * Wikidata itself: P3962 GTIN, P176 manufacturer, P1716 brand, P179 part of the series, P577
 * publication date, P13351 model number, P18 image, P856 official website; P31/P279 as used on a
 * live product item.
 *
 * - The SPARQL query service is not used (its v1 is being replaced; the Action API is enough).
 * - Wikidata items are product models, not purchasable configurations; few have GTINs (about
 *   2,900 items in total on 2026-11-27), so discovery by search or item ID is the main path.
 * - A model number is set only when the item has exactly one: several (often per region) are
 *   regional variants and are never merged into one product.
 */

export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
/** The 2026 limit for compliant User-Agents is 200/min across all Wikimedia sites. */
export const WIKIDATA_PER_MINUTE = 150;
const LANG = "en";
const MAX_IMAGES = 3;
const MAX_FEATURES = 60;
/** wbgetentities accepts at most 50 IDs per request. */
const IDS_PER_REQUEST = 50;
const MAXLAG = "5";

const PROP = {
  instanceOf: "P31",
  subclassOf: "P279",
  manufacturer: "P176",
  brand: "P1716",
  series: "P179",
  published: "P577",
  modelNumber: "P13351",
  gtin: "P3962",
  image: "P18",
  website: "P856",
} as const;
/** Claims used as record fields, not repeated as features. */
const FIELD_PROPS = new Set<string>(Object.values(PROP));

const QID = /^Q[1-9]\d{0,11}$/;

// ── Response schemas (Wikibase JSON; MediaWiki Action API) ─────────────────────────────────────

const snakSchema = z.object({
  snaktype: z.string(),
  property: z.string(),
  datatype: z.string().optional(),
  datavalue: z.object({ type: z.string(), value: z.unknown() }).optional(),
});
const statementSchema = z.object({
  mainsnak: snakSchema,
  rank: z.enum(["preferred", "normal", "deprecated"]).catch("normal"),
});
const termSchema = z.object({ language: z.string(), value: z.string() });
const entitySchema = z.object({
  id: z.string().optional(),
  missing: z.unknown().optional(),
  labels: z.record(z.string(), termSchema).optional().catch(undefined),
  descriptions: z.record(z.string(), termSchema).optional().catch(undefined),
  claims: z.record(z.string(), z.array(statementSchema).catch([])).optional().catch(undefined),
});
type Entity = z.infer<typeof entitySchema>;
type Statement = z.infer<typeof statementSchema>;

const apiError = z.object({ error: z.object({ code: z.string(), info: z.string().optional() }) });
const entitiesSchema = z.object({ entities: z.record(z.string(), entitySchema) });
const searchSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })).catch([]) }),
});
const extValue = z.object({ value: z.unknown() }).optional().catch(undefined);
const imageInfoSchema = z.object({
  query: z.object({
    pages: z
      .array(
        z.object({
          title: z.string(),
          missing: z.unknown().optional(),
          imageinfo: z
            .array(
              z.object({
                url: z.string().optional(),
                descriptionurl: z.string().optional(),
                width: z.number().optional(),
                height: z.number().optional(),
                thumburl: z.string().optional(),
                thumbwidth: z.number().optional(),
                thumbheight: z.number().optional(),
                mime: z.string().optional(),
                extmetadata: z.record(z.string(), extValue).optional().catch(undefined),
              }),
            )
            .optional()
            .catch(undefined),
        }),
      )
      .catch([]),
  }),
});

const fail = (message: string, status: number | null, retryable = false, retryAfterMs?: number) =>
  new ProviderHttpError("wikidata", message, status, retryable, retryAfterMs ?? null);

/** True unless the body is a MediaWiki error (which can come with HTTP 200, e.g. maxlag). */
export function isCacheableBody(body: string): boolean {
  try {
    const j = JSON.parse(body) as unknown;
    return !(j && typeof j === "object" && "error" in j);
  } catch {
    return false;
  }
}

/** Parses an Action API response, turning MediaWiki errors into provider errors. */
export function parseApiBody<T>(status: number, body: string, schema: z.ZodType<T>): T {
  if (status === 403)
    throw fail(
      "request refused (HTTP 403): check that WIKIDATA_USER_AGENT names the client and has contact details",
      status,
    );
  if (status >= 400) throw fail(`request refused (HTTP ${status})`, status);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw fail(`HTTP ${status}: response is not JSON`, status);
  }
  const err = apiError.safeParse(json);
  if (err.success) {
    const { code } = err.data.error;
    // Manual:Maxlag — pause at least 5 s; the job is rescheduled instead of failing items.
    if (code === "maxlag") throw fail("database lag (maxlag); retrying later", status, true, 5_000);
    if (code === "ratelimited") throw fail("rate limited by the API", status, true, 60_000);
    throw fail(`API error "${code}"`, status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw fail("unexpected response shape", status);
  return parsed.data;
}

// ── Claims helpers ──────────────────────────────────────────────────────────────────────────────

/** Wikibase "best" statements: never deprecated; only preferred ones when any exist. */
export function bestStatements(entity: Entity, property: string): Statement[] {
  const all = (entity.claims?.[property] ?? []).filter(
    (s) => s.rank !== "deprecated" && s.mainsnak.snaktype === "value" && s.mainsnak.datavalue,
  );
  const preferred = all.filter((s) => s.rank === "preferred");
  return preferred.length ? preferred : all;
}

const entityIdOf = (s: Statement): string | null => {
  const v = s.mainsnak.datavalue?.value as { id?: unknown } | undefined;
  return typeof v?.id === "string" && /^[QP][1-9]\d*$/.test(v.id) ? v.id : null;
};
const stringOf = (s: Statement): string | null => {
  const v = s.mainsnak.datavalue?.value;
  if (typeof v === "string") return v.trim() || null;
  const text = (v as { text?: unknown } | undefined)?.text;
  return typeof text === "string" ? text.trim() || null : null;
};

/** Wikibase time → ISO date at the stated precision (11 day, 10 month, 9 year); else null. */
export function wikibaseDate(s: Statement): string | null {
  const v = s.mainsnak.datavalue?.value as { time?: unknown; precision?: unknown } | undefined;
  if (typeof v?.time !== "string" || typeof v.precision !== "number") return null;
  const m = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(v.time);
  if (!m) return null;
  if (v.precision >= 11) return `${m[1]}-${m[2]}-${m[3]}`;
  if (v.precision === 10) return `${m[1]}-${m[2]}`;
  if (v.precision === 9) return m[1]!;
  return null;
}

/** Quantity → amount without the "+" sign and the unit's item ID ("1" = no unit). */
function quantityOf(s: Statement): { amount: string; unitId: string | null } | null {
  const v = s.mainsnak.datavalue?.value as { amount?: unknown; unit?: unknown } | undefined;
  if (typeof v?.amount !== "string") return null;
  const unit = typeof v.unit === "string" ? /\/entity\/(Q[1-9]\d*)$/.exec(v.unit)?.[1] : undefined;
  return { amount: v.amount.replace(/^\+/, ""), unitId: unit ?? null };
}

const labelOf = (e: Entity | undefined): string | null => {
  const t = e?.labels?.[LANG]?.value?.trim();
  return t ? t : null;
};

/** IDs whose labels the record needs (brand, series, category, feature values, units, properties). */
export function referencedIds(entity: Entity): string[] {
  const ids = new Set<string>();
  const add = (id: string | null) => id && ids.add(id);
  for (const p of [PROP.brand, PROP.manufacturer, PROP.series, PROP.subclassOf, PROP.instanceOf])
    bestStatements(entity, p)
      .slice(0, 1)
      .forEach((s) => add(entityIdOf(s)));
  for (const p of featureProperties(entity)) {
    add(p);
    for (const s of bestStatements(entity, p)) {
      if (s.mainsnak.datatype === "wikibase-item") add(entityIdOf(s));
      if (s.mainsnak.datatype === "quantity") add(quantityOf(s)?.unitId ?? null);
    }
  }
  return [...ids];
}

const FEATURE_TYPES = new Set(["quantity", "wikibase-item", "string", "monolingualtext", "time"]);
function featureProperties(entity: Entity): string[] {
  return Object.keys(entity.claims ?? {})
    .filter((p) => !FIELD_PROPS.has(p))
    .filter((p) => FEATURE_TYPES.has(entity.claims?.[p]?.[0]?.mainsnak.datatype ?? ""))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .slice(0, MAX_FEATURES);
}

function features(entity: Entity, labels: Map<string, Entity>): ProviderFeature[] {
  const out: ProviderFeature[] = [];
  for (const p of featureProperties(entity)) {
    const statements = bestStatements(entity, p);
    const type = statements[0]?.mainsnak.datatype;
    const name = labelOf(labels.get(p)) ?? p;
    if (type === "quantity") {
      // Only a single value: several quantities for one property are usually different
      // configurations (e.g. 128 and 256 GB storage) and are never merged into one value.
      const values = statements.map(quantityOf).filter((q) => q !== null);
      if (values.length !== 1) continue;
      const { amount, unitId } = values[0]!;
      const unit = unitId ? labelOf(labels.get(unitId)) : null;
      if (unitId && !unit) continue; // never guess a unit
      out.push({ externalId: p, name, value: amount, unit });
      continue;
    }
    const values = statements
      .map((s) =>
        type === "wikibase-item"
          ? labelOf(labels.get(entityIdOf(s) ?? ""))
          : type === "time"
            ? wikibaseDate(s)
            : stringOf(s),
      )
      .filter((v): v is string => Boolean(v));
    if (values.length) out.push({ externalId: p, name, value: values.join("; "), unit: null });
  }
  return out;
}

// ── Commons images ──────────────────────────────────────────────────────────────────────────────

const meta = (m: Record<string, { value?: unknown } | undefined> | undefined, key: string) => {
  const v = m?.[key]?.value;
  return typeof v === "string" ? v : null;
};
const truthy = (s: string | null) => s !== null && /^(true|1|yes)$/i.test(s.trim());

/**
 * Commons imageinfo → ProviderImages with the file's own author, licence and credit line. Files
 * without a stated licence, or marked non-free, are skipped. Thumbnails (always raster) on
 * upload.wikimedia.org are used; the file page is kept for the credit link.
 */
export function commonsImages(data: z.infer<typeof imageInfoSchema>): ProviderImage[] {
  const out: ProviderImage[] = [];
  for (const page of data.query.pages) {
    const info = page.imageinfo?.[0];
    if (page.missing !== undefined || !info) continue;
    const m = info.extmetadata;
    const licence = plainText(meta(m, "LicenseShortName"), 200);
    if (!licence || truthy(meta(m, "NonFree"))) continue;
    const url = info.thumburl ?? info.url;
    if (!url || !/^https:\/\/upload\.wikimedia\.org\//.test(url)) continue;
    const author = plainText(meta(m, "Artist"), 200);
    const custom = plainText(meta(m, "Attribution"), 300);
    const restrictions = (meta(m, "Restrictions") ?? "")
      .split("|")
      .map((r) => r.trim())
      .filter(Boolean);
    out.push({
      url,
      width: info.thumburl ? (info.thumbwidth ?? null) : (info.width ?? null),
      height: info.thumburl ? (info.thumbheight ?? null) : (info.height ?? null),
      author,
      licence,
      licenceUrl: meta(m, "LicenseUrl")?.trim() || null,
      // Commons:Credit line — "author, licence, via Wikimedia Commons", unless the file gives its own.
      attribution: custom ?? [author, licence, "via Wikimedia Commons"].filter(Boolean).join(", "),
      sourceUrl:
        info.descriptionurl && /^https:\/\//.test(info.descriptionurl) ? info.descriptionurl : null,
      restrictions,
    });
  }
  return out;
}

// ── Record ──────────────────────────────────────────────────────────────────────────────────────

/** One Wikidata item (+ labels of what it references, + Commons images) → ProviderRecord. */
export function wikidataRecord(
  entity: Entity & { id: string },
  labels: Map<string, Entity>,
  images: ProviderImage[],
  payloadHash: string,
  now: Date,
): ProviderRecord {
  const firstId = (p: string) => {
    const s = bestStatements(entity, p)[0];
    return s ? entityIdOf(s) : null;
  };
  const brandId = firstId(PROP.brand) ?? firstId(PROP.manufacturer);
  // Product models are usually "instance of: product model" and "subclass of: <kind>", so the
  // subclass names the kind of product; the admin maps it to our category.
  const categoryId = firstId(PROP.subclassOf) ?? firstId(PROP.instanceOf);
  const models = bestStatements(entity, PROP.modelNumber).map(stringOf).filter(Boolean);
  const released = bestStatements(entity, PROP.published).map(wikibaseDate).filter(Boolean);
  return {
    provider: "wikidata",
    providerProductId: entity.id,
    url: `https://www.wikidata.org/wiki/${entity.id}`,
    brand: brandId ? labelOf(labels.get(brandId)) : null,
    name: labelOf(entity),
    modelNumber: models.length === 1 ? models[0]! : null,
    mpn: null,
    gtins: bestStatements(entity, PROP.gtin)
      .map(stringOf)
      .filter((g): g is string => Boolean(g)),
    categoryExternalId: categoryId,
    categoryName: categoryId ? labelOf(labels.get(categoryId)) : null,
    family: (() => {
      const id = firstId(PROP.series);
      return id ? labelOf(labels.get(id)) : null;
    })(),
    // Several release dates (e.g. per market) are not reduced to one.
    releaseDate: released.length === 1 ? released[0]! : null,
    description: null,
    features: features(entity, labels),
    images,
    quality: null,
    retrievedAt: now,
    payloadHash,
  };
}

/** GTIN-14 → the forms Wikidata may store (14, 13 and 12 digits), OR-ed in one search. */
export function gtinSearch(gtin14: string): string {
  const forms = new Set([gtin14, gtin14.replace(/^0/, ""), gtin14.replace(/^00/, "")]);
  return `haswbstatement:${[...forms]
    .filter((f) => f.length >= 12)
    .map((f) => `${PROP.gtin}=${f}`)
    .join("|")}`;
}

export function createWikidataAdapter(): ProviderAdapter {
  const cacheTtlSeconds = 7 * 86_400;

  async function api<T>(
    base: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
    ctx: ProviderContext,
    cache = true,
  ): Promise<{ data: T; body: string }> {
    const q = new URLSearchParams({ format: "json", maxlag: MAXLAG, ...params });
    const res = await ctx.http.request(`${base}?${q.toString()}`, {
      cacheTtlSeconds: cache ? cacheTtlSeconds : undefined,
      cacheable: isCacheableBody,
    });
    return { data: parseApiBody(res.status, res.body, schema), body: res.body };
  }

  async function entities(ids: string[], props: string, ctx: ProviderContext) {
    const out = new Map<string, Entity>();
    const bodies: string[] = [];
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
      const { data, body } = await api(
        WIKIDATA_API,
        {
          action: "wbgetentities",
          ids: ids.slice(i, i + IDS_PER_REQUEST).join("|"),
          props,
          languages: LANG,
          languagefallback: "1",
        },
        entitiesSchema,
        ctx,
      );
      bodies.push(body);
      for (const [id, e] of Object.entries(data.entities))
        if (e.missing === undefined) out.set(id, e);
    }
    return { entities: out, bodies };
  }

  async function images(entity: Entity, ctx: ProviderContext): Promise<ProviderImage[]> {
    const files = bestStatements(entity, PROP.image)
      .map(stringOf)
      .filter((f): f is string => Boolean(f))
      .slice(0, MAX_IMAGES);
    if (files.length === 0) return [];
    const { data } = await api(
      COMMONS_API,
      {
        action: "query",
        prop: "imageinfo",
        titles: files.map((f) => `File:${f}`).join("|"),
        iiprop: "url|size|mime|extmetadata",
        iiurlwidth: "1280",
        iiextmetadatafilter:
          "Artist|LicenseShortName|LicenseUrl|Attribution|AttributionRequired|NonFree|Restrictions",
        iiextmetadatalanguage: LANG,
        formatversion: "2",
      },
      imageInfoSchema,
      ctx,
    );
    return commonsImages(data);
  }

  async function fetchRecord(id: string, ctx: ProviderContext): Promise<ProviderRecord | null> {
    const main = await entities([id], "labels|descriptions|claims", ctx);
    const entity = main.entities.get(id);
    if (!entity) return null;
    const refs = await entities(referencedIds(entity), "labels", ctx);
    const imgs = await images(entity, ctx);
    const hash = createHash("sha256")
      .update(main.bodies.join("\n"))
      .update(refs.bodies.join("\n"))
      .update(JSON.stringify(imgs))
      .digest("hex");
    return wikidataRecord({ ...entity, id }, refs.entities, imgs, hash, new Date());
  }

  async function searchIds(srsearch: string, limit: number, ctx: ProviderContext) {
    const { data } = await api(
      WIKIDATA_API,
      { action: "query", list: "search", srsearch, srnamespace: "0", srlimit: String(limit) },
      searchSchema,
      ctx,
    );
    return data.query.search.map((h) => h.title).filter((t) => QID.test(t));
  }

  return {
    key: "wikidata",
    displayName: "Wikidata + Wikimedia Commons",
    capabilities: {
      lookupByGtin: true,
      search: true,
      fetchById: true,
      specs: true,
      images: true,
      offers: false,
    },
    licence: {
      name: "CC0 1.0 (Wikidata structured data); images: each Commons file's own licence",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
      usage: "store",
      // CC0 needs no attribution; Commons images carry their own credit line.
      attributionRequired: false,
      attribution: "Data from Wikidata (CC0)",
      imageLicence: "per_image",
      unverified: false,
    },
    quotas: [{ bucket: "requests", limit: WIKIDATA_PER_MINUTE, windowSeconds: 60 }],
    allowedHosts: ["www.wikidata.org", "commons.wikimedia.org"],
    // Requests in series (API:Etiquette), at most 150 a minute.
    minIntervalMs: 400,
    // Item + labels + Commons images (more labels when an item has many statements).
    requestCost: { lookupByGtin: 4, search: 2, fetchById: 3 },
    cacheTtlSeconds,
    // Community-edited data ranks below manufacturer-sourced data (e.g. Open Icecat, 0.7).
    recordConfidence: () => 0.5,
    missingConfig: (e: Env) => missingProviderConfig("wikidata", e),

    async healthCheck(ctx): Promise<ProviderHealth> {
      const checkedAt = new Date();
      try {
        const r = await entities([PROP.gtin], "labels", ctx);
        return r.entities.has(PROP.gtin)
          ? { status: "ok", message: null, checkedAt }
          : { status: "degraded", message: "Unexpected answer from Wikidata", checkedAt };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          status: e instanceof ProviderHttpError && e.retryable ? "degraded" : "error",
          message,
          checkedAt,
        };
      }
    },

    async lookupByGtin(gtin14, ctx) {
      const ids = await searchIds(gtinSearch(gtin14), 3, ctx);
      const out: ProviderRecord[] = [];
      for (const id of ids) {
        const r = await fetchRecord(id, ctx);
        if (r) out.push(r);
      }
      return out;
    },

    async search(query, ctx): Promise<ProviderSearchHit[]> {
      const text = query.replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) return [];
      // Product models carry a manufacturer or a brand; this keeps people and places out.
      const ids = await searchIds(
        `${text} haswbstatement:${PROP.manufacturer}|${PROP.brand}`,
        20,
        ctx,
      );
      if (ids.length === 0) return [];
      const { entities: found } = await entities(ids, "labels|claims", ctx);
      return ids.flatMap((id) => {
        const e = found.get(id);
        if (!e) return [];
        const models = bestStatements(e, PROP.modelNumber).map(stringOf).filter(Boolean);
        return [
          {
            providerProductId: id,
            brand: null,
            name: labelOf(e),
            modelNumber: models.length === 1 ? models[0]! : null,
            gtins: bestStatements(e, PROP.gtin)
              .map(stringOf)
              .filter((g): g is string => Boolean(g)),
          },
        ];
      });
    },

    async fetchById(id, ctx) {
      if (!QID.test(id))
        throw fail(`"${id}" is not a Wikidata item ID (Q followed by digits)`, null);
      return fetchRecord(id, ctx);
    },
  };
}
