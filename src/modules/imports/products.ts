import { sql } from "drizzle-orm";
import { z } from "zod";
import { productSpecifications, products, productVariants, type sources } from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { slugify } from "@/lib/validation";
import { addSourceRecord } from "@/modules/catalog-admin/service";
import type { ServiceContext } from "@/modules/_shared/context";
import { ValidationError } from "@/modules/_shared/errors";
import { createProduct, updateProduct } from "@/modules/products/service";
import { createReviewItem } from "@/modules/review-queue/service";
import {
  parseSpecificationValue,
  sameValue,
  type SpecValueColumns,
} from "@/modules/specifications/parse";
import {
  getEffectiveDefinitionsForCategories,
  setSpecificationValue,
  type EffectiveDefinition,
} from "@/modules/specifications/service";
import { createProductVariant, updateProductVariant } from "@/modules/variants/service";
import { SPEC_PREFIX } from "./columns";
import type { RowIssue, RowPlan } from "./types";

type Source = typeof sources.$inferSelect;
type Product = typeof products.$inferSelect;
type Variant = typeof productVariants.$inferSelect;
type SpecRow = typeof productSpecifications.$inferSelect;

// ─── Row parsing ───────────────────────────────────────────────────────────────────────

/** GTIN-8/12/13/14 with a valid check digit. */
export function isValidGtin(v: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(v)) return false;
  const digits = [...v].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Model numbers match ignoring case, spaces and punctuation ("AB-12 x" = "ab12x"). */
export const normalizeModel = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const isoDate = z
  .string()
  .trim()
  .transform((v) => v || null)
  .refine((v) => {
    if (v === null) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Use a real date as YYYY-MM-DD");

const boolWord = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => ["", "true", "false", "yes", "no", "1", "0"].includes(v), "Use true or false")
  .transform((v) => (v === "" ? null : ["true", "yes", "1"].includes(v)));

const rowSchema = z.object({
  brand: z.string().trim().min(1, "Required").max(120),
  category_slug: z.string().trim().min(1, "Required").max(120),
  product_name: z.string().trim().min(1, "Required").max(200),
  model_number: opt(80),
  mpn: opt(80),
  product_status: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (v) => ["", "announced", "active", "discontinued", "unknown"].includes(v),
      "Use announced, active, discontinued or unknown",
    )
    .transform((v) => (v || null) as "announced" | "active" | "discontinued" | "unknown" | null),
  release_date: isoDate,
  variant_name: opt(160),
  variant_code: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (v) => v === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v),
      "Use lowercase letters, digits and dashes",
    )
    .transform((v) => v || null),
  region_code: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "Use a two-letter code such as EU or US")
    .transform((v) => v || null),
  color: opt(80),
  memory: opt(80),
  storage: opt(80),
  gtin: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || isValidGtin(v),
      "Not a valid GTIN (8, 12, 13 or 14 digits with check digit)",
    )
    .transform((v) => v || null),
  source_name: opt(200),
  source_url: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https?:\/\/\S+$/.test(v), "Use a full http(s) URL")
    .transform((v) => v || null),
  is_demo: boolWord,
});

export interface ProductRowData {
  brand: string;
  categorySlug: string;
  productName: string;
  modelNumber: string | null;
  mpn: string | null;
  productStatus: "announced" | "active" | "discontinued" | "unknown" | null;
  releaseDate: string | null;
  variant: {
    name: string;
    code: string | null;
    /** undefined = the column is not in the file (don't compare regions). */
    regionCode: string | null | undefined;
    color: string | null;
    memory: string | null;
    storage: string | null;
    gtin: string | null;
  } | null;
  sourceName: string | null;
  sourceUrl: string | null;
  isDemo: boolean | null;
  specs: Record<string, string>;
}

/** Validates the shape of one mapped row (references are resolved later, in bulk). */
export function parseProductRow(mapped: Record<string, string>): {
  data: ProductRowData | null;
  issues: RowIssue[];
} {
  const filled = Object.fromEntries(rowSchema.keyof().options.map((k) => [k, mapped[k] ?? ""]));
  const r = rowSchema.safeParse(filled);
  if (!r.success) {
    return {
      data: null,
      issues: r.error.issues.map((i) => ({ field: String(i.path[0]), message: i.message })),
    };
  }
  const d = r.data;
  const issues: RowIssue[] = [];
  const hasVariant = Boolean(
    d.variant_name || d.variant_code || d.gtin || d.color || d.memory || d.storage || d.region_code,
  );
  if (hasVariant && !d.variant_name)
    issues.push({ field: "variant_name", message: "Variant columns need a variant name" });
  const specs: Record<string, string> = {};
  for (const [k, v] of Object.entries(mapped)) {
    if (k.startsWith(SPEC_PREFIX) && v.trim() !== "") specs[k.slice(SPEC_PREFIX.length)] = v.trim();
  }
  if (issues.length) return { data: null, issues };
  return {
    data: {
      brand: d.brand,
      categorySlug: d.category_slug.toLowerCase(),
      productName: d.product_name,
      modelNumber: d.model_number,
      mpn: d.mpn,
      productStatus: d.product_status,
      releaseDate: d.release_date,
      variant: hasVariant
        ? {
            name: d.variant_name!,
            code: d.variant_code,
            regionCode: "region_code" in mapped ? d.region_code : undefined,
            color: d.color,
            memory: d.memory,
            storage: d.storage,
            gtin: d.gtin,
          }
        : null,
      sourceName: d.source_name,
      sourceUrl: d.source_url,
      isDemo: d.is_demo,
      specs,
    },
    issues: [],
  };
}

// ─── Bulk reference lookups ────────────────────────────────────────────────────────────

const uniq = <T>(xs: T[]) => [...new Set(xs)];
// `type` is one of a fixed set of SQL type names (never user input).
const arr = <T>(xs: T[], type: "text" | "uuid" | "int") =>
  sql`${sql.param(xs)}::${sql.raw(type)}[]`;

/** A reviewer's decision on an import row (stored in the review item's payload). */
export interface Resolution {
  status: string;
  /** The product this row belongs to (chosen, or created when the reviewer said "new"). */
  productId?: string;
  /** The variant this row belongs to (chosen, or created for "new variant"). */
  variantId?: string | null;
  /** "Different product": create it even though the name is similar. */
  newProduct?: boolean;
  /** "Different variant": create a new variant even though one matches. */
  newVariant?: boolean;
}

interface Lookups {
  brands: Map<string, { id: string; name: string }>;
  categories: Map<string, { id: string; name: string }>;
  defs: Map<string, EffectiveDefinition[]>;
  sources: Map<string, Source>;
  byGtin: Map<string, { productId: string; variantId: string; brandId: string }>;
  byMpn: Map<string, string[]>; // `${brandId}|${lower mpn}` → product ids
  byModel: Map<string, string[]>; // `${brandId}|${normalized}` → product ids
  similar: Map<number, { id: string; name: string; score: number }[]>; // row index → candidates
  resolutions: Map<string, Resolution>;
  products: Map<string, Product>;
  variants: Map<string, Variant[]>; // product id → variants
  specs: Map<string, SpecRow[]>; // product id → spec rows
  sourceRecords: Set<string>; // `${productId}|${sourceId}` (product-level)
}

async function loadLookups(
  db: DbOrTx,
  rows: { idx: number; data: ProductRowData; hash: string }[],
): Promise<Lookups> {
  const brandNames = uniq(rows.map((r) => r.data.brand));
  const catSlugs = uniq(rows.map((r) => r.data.categorySlug));
  const sourceNames = uniq(rows.map((r) => r.data.sourceName).filter((s): s is string => !!s));
  const gtins = uniq(rows.map((r) => r.data.variant?.gtin).filter((g): g is string => !!g));

  const [brandRows, catRows, sourceRows, gtinRows, resolutionRows] = await Promise.all([
    db.execute<{ input: string; id: string; name: string }>(sql`
      SELECT DISTINCT ON (x) x AS input, b.id, b.name FROM unnest(${arr(brandNames, "text")}) AS x
      JOIN brands b ON lower(sb_unaccent(b.name)) = lower(sb_unaccent(x)) OR b.slug = lower(x)
        OR EXISTS (SELECT 1 FROM unnest(b.aliases) a WHERE lower(sb_unaccent(a)) = lower(sb_unaccent(x)))
      ORDER BY x, (lower(b.name) = lower(x)) DESC`),
    db.execute<{ slug: string; id: string; name: string }>(sql`
      SELECT slug, id, name FROM categories WHERE slug = ANY(${arr(catSlugs, "text")})`),
    sourceNames.length
      ? db.execute<Source & { input: string }>(sql`
          SELECT x AS input, s.id, s.source_name AS "sourceName", s.usage_permitted AS "usagePermitted"
          FROM unnest(${arr(sourceNames, "text")}) AS x JOIN sources s ON lower(s.source_name) = lower(x)`)
      : Promise.resolve([]),
    gtins.length
      ? db.execute<{ gtin: string; variant_id: string; product_id: string; brand_id: string }>(sql`
          SELECT v.barcode_gtin AS gtin, v.id AS variant_id, v.product_id, p.brand_id
          FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.barcode_gtin = ANY(${arr(gtins, "text")})`)
      : Promise.resolve([]),
    db.execute<{ hash: string; status: string; resolution: Omit<Resolution, "status"> | null }>(sql`
      SELECT DISTINCT ON (payload->>'rowHash') payload->>'rowHash' AS hash, status, payload->'resolution' AS resolution
      FROM review_items
      WHERE item_type IN ('duplicate_candidate', 'variant_ambiguity') AND payload->>'rowHash' = ANY(${arr(uniq(rows.map((r) => r.hash)), "text")})
      ORDER BY payload->>'rowHash', created_at DESC`),
  ]);

  const brands = new Map(brandRows.map((b) => [b.input, { id: b.id, name: b.name }]));
  const categories = new Map(catRows.map((c) => [c.slug, { id: c.id, name: c.name }]));
  const defs = await getEffectiveDefinitionsForCategories(
    db,
    [...categories.values()].map((c) => c.id),
  );

  // Identifier matches within each row's brand.
  const mpnPairs: [string, string][] = [];
  const modelPairs: [string, string][] = [];
  for (const r of rows) {
    const b = brands.get(r.data.brand);
    if (!b) continue;
    if (r.data.mpn) mpnPairs.push([b.id, r.data.mpn.toLowerCase()]);
    if (r.data.modelNumber) modelPairs.push([b.id, normalizeModel(r.data.modelNumber)]);
  }
  const [mpnRows, modelRows] = await Promise.all([
    mpnPairs.length
      ? db.execute<{ brand_id: string; mpn: string; product_id: string }>(sql`
          SELECT x.brand_id, x.mpn, p.id AS product_id
          FROM unnest(${arr(
            mpnPairs.map((p) => p[0]),
            "uuid",
          )}, ${arr(
            mpnPairs.map((p) => p[1]),
            "text",
          )}) AS x(brand_id, mpn)
          JOIN products p ON p.brand_id = x.brand_id AND lower(p.manufacturer_part_number) = x.mpn
          UNION
          SELECT x.brand_id, x.mpn, p.id
          FROM unnest(${arr(
            mpnPairs.map((p) => p[0]),
            "uuid",
          )}, ${arr(
            mpnPairs.map((p) => p[1]),
            "text",
          )}) AS x(brand_id, mpn)
          JOIN products p ON p.brand_id = x.brand_id
          JOIN product_variants v ON v.product_id = p.id AND lower(v.manufacturer_part_number) = x.mpn`)
      : Promise.resolve([]),
    modelPairs.length
      ? db.execute<{ brand_id: string; norm: string; product_id: string }>(sql`
          SELECT DISTINCT x.brand_id, x.norm, p.id AS product_id
          FROM unnest(${arr(
            modelPairs.map((p) => p[0]),
            "uuid",
          )}, ${arr(
            modelPairs.map((p) => p[1]),
            "text",
          )}) AS x(brand_id, norm)
          JOIN products p ON p.brand_id = x.brand_id AND regexp_replace(lower(p.model_number), '[^[:alnum:]]', '', 'g') = x.norm`)
      : Promise.resolve([]),
  ]);
  const group = (pairs: { k: string; id: string }[]) => {
    const m = new Map<string, string[]>();
    for (const { k, id } of pairs) m.set(k, uniq([...(m.get(k) ?? []), id]));
    return m;
  };
  const byMpn = group(mpnRows.map((r) => ({ k: `${r.brand_id}|${r.mpn}`, id: r.product_id })));
  const byModel = group(modelRows.map((r) => ({ k: `${r.brand_id}|${r.norm}`, id: r.product_id })));
  const byGtin = new Map(
    gtinRows.map((g) => [
      g.gtin,
      { productId: g.product_id, variantId: g.variant_id, brandId: g.brand_id },
    ]),
  );

  // Name similarity only for rows with no identifier match (SPEC §9.6 step 6, last resort).
  const simInput = rows.filter((r) => {
    const b = brands.get(r.data.brand);
    if (!b) return false;
    if (r.data.variant?.gtin && byGtin.has(r.data.variant.gtin)) return false;
    if (r.data.mpn && byMpn.has(`${b.id}|${r.data.mpn.toLowerCase()}`)) return false;
    if (r.data.modelNumber && byModel.has(`${b.id}|${normalizeModel(r.data.modelNumber)}`))
      return false;
    return true;
  });
  const simRows = simInput.length
    ? await db.execute<{ idx: number; id: string; name: string; score: number }>(sql`
        SELECT x.idx, p.id, p.name, similarity(lower(p.name), lower(x.name))::float AS score
        FROM unnest(${arr(
          simInput.map((r) => r.idx),
          "int",
        )}, ${arr(
          simInput.map((r) => brands.get(r.data.brand)!.id),
          "uuid",
        )},
                    ${arr(
                      simInput.map((r) => r.data.productName),
                      "text",
                    )}) AS x(idx, brand_id, name)
        JOIN products p ON p.brand_id = x.brand_id AND similarity(lower(p.name), lower(x.name)) >= 0.6
        ORDER BY x.idx, score DESC`)
    : [];
  const similar = new Map<number, { id: string; name: string; score: number }[]>();
  for (const s of simRows)
    similar.set(
      s.idx,
      [...(similar.get(s.idx) ?? []), { id: s.id, name: s.name, score: Number(s.score) }].slice(
        0,
        5,
      ),
    );

  const resolutions = new Map(
    resolutionRows.map((r) => [r.hash, { ...(r.resolution ?? {}), status: r.status }]),
  );

  const productIds = uniq([
    ...gtinRows.map((g) => g.product_id),
    ...mpnRows.map((r) => r.product_id),
    ...modelRows.map((r) => r.product_id),
    ...[...resolutions.values()].map((r) => r.productId).filter((x): x is string => !!x),
  ]);
  const [productRows, variantRows, specRows, recordRows] = productIds.length
    ? await Promise.all([
        db
          .select()
          .from(products)
          .where(sql`${products.id} = ANY(${arr(productIds, "uuid")})`),
        db
          .select()
          .from(productVariants)
          .where(sql`${productVariants.productId} = ANY(${arr(productIds, "uuid")})`),
        db
          .select()
          .from(productSpecifications)
          .where(sql`${productSpecifications.productId} = ANY(${arr(productIds, "uuid")})`),
        db.execute<{ product_id: string; source_id: string }>(sql`
          SELECT product_id, source_id FROM product_source_records WHERE variant_id IS NULL AND product_id = ANY(${arr(productIds, "uuid")})`),
      ])
    : [[], [], [], []];
  const variants = new Map<string, Variant[]>();
  for (const v of variantRows) variants.set(v.productId, [...(variants.get(v.productId) ?? []), v]);
  const specs = new Map<string, SpecRow[]>();
  for (const s of specRows) specs.set(s.productId, [...(specs.get(s.productId) ?? []), s]);

  return {
    brands,
    categories,
    defs,
    sources: new Map((sourceRows as (Source & { input: string })[]).map((s) => [s.input, s])),
    byGtin,
    byMpn,
    byModel,
    similar,
    resolutions,
    products: new Map(productRows.map((p) => [p.id, p])),
    variants,
    specs,
    sourceRecords: new Set(recordRows.map((r) => `${r.product_id}|${r.source_id}`)),
  };
}

// ─── Planning ──────────────────────────────────────────────────────────────────────────

export interface ProductRowPlan extends RowPlan {
  data: ProductRowData | null;
  brandId?: string;
  categoryId?: string;
  sourceId?: string;
  /** Existing product, or null with a groupKey for a product this import creates. */
  productId: string | null;
  groupKey: string | null;
  variantId: string | null;
  createVariant: boolean;
  productChanges: Record<string, unknown>;
  variantChanges: Record<string, unknown>;
  specWrites: { key: string; raw: string; scope: "product" | "variant" }[];
  addSourceRecord: boolean;
  conflict?: {
    type: "duplicate_candidate" | "variant_ambiguity";
    reason: string;
    candidates: { id: string; name: string; score?: number }[];
  };
}

export interface ProductPlanInput {
  idx: number;
  rowNumber: number;
  hash: string;
  data: ProductRowData | null;
  issues: RowIssue[];
}

function emptyPlan(r: ProductPlanInput): ProductRowPlan {
  return {
    action: "error",
    issues: [...r.issues],
    notes: [],
    data: r.data,
    productId: null,
    groupKey: null,
    variantId: null,
    createVariant: false,
    productChanges: {},
    variantChanges: {},
    specWrites: [],
    addSourceRecord: false,
  };
}

const valueKey = (v: SpecValueColumns) => JSON.stringify(v);

/**
 * Resolves every row against the database and the rest of the file and decides what committing
 * it would do: create, update, skip (nothing would change), conflict (needs a human) or error.
 */
export async function planProductRows(
  db: DbOrTx,
  input: ProductPlanInput[],
  jobSource: Source,
): Promise<ProductRowPlan[]> {
  const valid = input.filter(
    (r): r is ProductPlanInput & { data: ProductRowData } => r.data !== null,
  );
  const L = await loadLookups(db, valid);
  const plans = input.map(emptyPlan);
  const seenHash = new Map<string, number>();
  const gtinOwner = new Map<string, string>(); // gtin → `${productKey}|${variant key}` within the file

  // Pass 1: references, product + variant identity.
  for (const [i, r] of input.entries()) {
    const p = plans[i]!;
    if (!r.data) continue;
    const d = r.data;
    const dup = seenHash.get(r.hash);
    if (dup !== undefined) {
      p.action = "skip";
      p.notes.push(`Same as row ${dup}`);
      continue;
    }
    seenHash.set(r.hash, r.rowNumber);

    const brand = L.brands.get(d.brand);
    if (!brand)
      p.issues.push({ field: "brand", message: `Unknown brand "${d.brand}" — create it first` });
    const category = L.categories.get(d.categorySlug);
    if (!category)
      p.issues.push({ field: "category_slug", message: `Unknown category "${d.categorySlug}"` });
    let source = jobSource;
    if (d.sourceName) {
      const s = L.sources.get(d.sourceName);
      if (!s) p.issues.push({ field: "source_name", message: `Unknown source "${d.sourceName}"` });
      else if (!s.usagePermitted)
        p.issues.push({
          field: "source_name",
          message: `"${s.sourceName}" does not permit use of its data`,
        });
      else source = s;
    }
    const defs = category ? (L.defs.get(category.id) ?? []) : [];
    for (const [key, raw] of Object.entries(d.specs)) {
      const def = defs.find((x) => x.key === key);
      if (!def) {
        if (category)
          p.issues.push({
            field: `spec.${key}`,
            message: `"${key}" is not a specification of ${category.name}`,
          });
        continue;
      }
      try {
        parseSpecificationValue(def, raw);
      } catch (e) {
        if (e instanceof ValidationError)
          p.issues.push({ field: `spec.${key}`, message: e.message });
        else throw e;
      }
    }
    if (p.issues.length || !brand || !category) continue;
    p.brandId = brand.id;
    p.categoryId = category.id;
    p.sourceId = source.id;

    // Earlier human decisions on this exact row win.
    const res = L.resolutions.get(r.hash);
    let productId: string | null = null;
    let variantId: string | null = null;
    if (res?.status === "rejected") {
      p.action = "skip";
      p.notes.push("Discarded earlier in the review queue");
      continue;
    }
    const decided = res?.status === "approved";
    if (decided && res.productId && L.products.has(res.productId)) {
      productId = res.productId;
      variantId = res.variantId ?? null;
    } else if (res?.status === "open") {
      p.action = "conflict";
      p.notes.push("Waiting in the review queue");
      continue;
    } else {
      // Duplicate detection order (SPEC §9.6): GTIN → brand + MPN → brand + model number → name.
      const candidates = new Set<string>();
      const g = d.variant?.gtin ? L.byGtin.get(d.variant.gtin) : undefined;
      if (g) {
        if (g.brandId !== brand.id) {
          p.issues.push({
            field: "gtin",
            message: "This GTIN belongs to a product of another brand",
          });
          continue;
        }
        productId = g.productId;
        variantId = g.variantId;
      }
      const mpnHits = d.mpn ? (L.byMpn.get(`${brand.id}|${d.mpn.toLowerCase()}`) ?? []) : [];
      const modelHits = d.modelNumber
        ? (L.byModel.get(`${brand.id}|${normalizeModel(d.modelNumber)}`) ?? [])
        : [];
      for (const id of [...mpnHits, ...modelHits]) candidates.add(id);
      if (!productId) {
        if (mpnHits.length === 1) productId = mpnHits[0]!;
        else if (mpnHits.length > 1) {
          p.issues.push({ field: "mpn", message: "This MPN matches several products" });
          continue;
        } else if (modelHits.length === 1) productId = modelHits[0]!;
        else if (modelHits.length > 1) {
          p.issues.push({
            field: "model_number",
            message: "This model number matches several products",
          });
          continue;
        }
      }
      if (productId && [...candidates].some((c) => c !== productId)) {
        p.issues.push({ message: "GTIN, MPN and model number point to different products" });
        continue;
      }
      if (!productId && !(decided && res.newProduct)) {
        const sim = L.similar.get(r.idx) ?? [];
        if (sim.length) {
          p.action = "conflict";
          p.conflict = {
            type: "duplicate_candidate",
            reason: `Similar to an existing ${brand.name} product (name similarity ≥ 0.6)`,
            candidates: sim.map((s) => ({
              id: s.id,
              name: s.name,
              score: Math.round(s.score * 100) / 100,
            })),
          };
          p.notes.push(`Possible duplicate of ${sim[0]!.name}`);
          continue;
        }
      }
    }

    if (productId) {
      const product = L.products.get(productId)!;
      if (product.categoryId !== category.id) {
        p.issues.push({
          field: "category_slug",
          message:
            "The matched product is in another category (moving products is not supported here)",
        });
        continue;
      }
      if (
        d.modelNumber &&
        product.modelNumber &&
        normalizeModel(product.modelNumber) !== normalizeModel(d.modelNumber)
      ) {
        p.issues.push({
          field: "model_number",
          message: `The matched product has model number ${product.modelNumber}`,
        });
        continue;
      }
      p.productId = productId;
      const ch: Record<string, unknown> = {};
      if (d.productName !== product.name) ch.name = d.productName;
      if (d.modelNumber && !product.modelNumber) ch.modelNumber = d.modelNumber;
      if (!d.variant && d.mpn && d.mpn !== product.manufacturerPartNumber)
        ch.manufacturerPartNumber = d.mpn;
      if (d.productStatus && d.productStatus !== product.productStatus)
        ch.productStatus = d.productStatus;
      if (d.releaseDate && d.releaseDate !== product.releaseDate) ch.releaseDate = d.releaseDate;
      if (d.isDemo !== null && d.isDemo !== product.isDemo) ch.isDemo = d.isDemo;
      p.productChanges = ch;
    } else {
      p.groupKey = `${brand.id}|${d.modelNumber ? `m:${normalizeModel(d.modelNumber)}` : `n:${d.productName.toLowerCase()}`}`;
    }

    // Variant identity: GTIN → code → name. Regional variants are never merged (rule 2.1.5).
    if (d.variant) {
      const v = d.variant;
      const existing = p.productId ? (L.variants.get(p.productId) ?? []) : [];
      const code = v.code ?? slugify(v.name);
      // A reviewer's variant decision replaces the automatic matching and its checks.
      const forced = decided && (Boolean(res.variantId) || res.newVariant === true);
      let match = variantId ? existing.find((x) => x.id === variantId) : undefined;
      if (match && !forced && v.code && match.variantCode !== v.code) {
        p.action = "conflict";
        p.conflict = {
          type: "variant_ambiguity",
          reason: `The GTIN belongs to variant "${match.variantName}" (${match.variantCode}) but the row says ${v.code}`,
          candidates: [{ id: match.id, name: match.variantName }],
        };
        p.notes.push("GTIN and variant code disagree");
        continue;
      }
      if (!forced)
        match ??=
          existing.find((x) => x.variantCode === code) ??
          existing.find((x) => x.variantName.toLowerCase() === v.name.toLowerCase());
      if (
        match &&
        !forced &&
        v.regionCode !== undefined &&
        (match.regionCode ?? null) !== v.regionCode
      ) {
        p.action = "conflict";
        p.conflict = {
          type: "variant_ambiguity",
          reason: `Variant "${match.variantName}" is for region ${match.regionCode ?? "global"}, the row says ${v.regionCode ?? "global"}`,
          candidates: [{ id: match.id, name: match.variantName }],
        };
        p.notes.push("Region differs from the matched variant");
        continue;
      }
      if (v.gtin) {
        const owner = gtinOwner.get(v.gtin);
        const me = `${p.productId ?? p.groupKey}|${match?.id ?? code}`;
        if (owner && owner !== me) {
          p.issues.push({
            field: "gtin",
            message: "This GTIN is used by another row for a different variant",
          });
          continue;
        }
        gtinOwner.set(v.gtin, me);
      }
      if (match) {
        p.variantId = match.id;
        const ch: Record<string, unknown> = {};
        if (v.name !== match.variantName) ch.variantName = v.name;
        if (v.color && v.color !== match.color) ch.color = v.color;
        if (v.memory && v.memory !== match.memoryConfiguration) ch.memoryConfiguration = v.memory;
        if (v.storage && v.storage !== match.storageConfiguration)
          ch.storageConfiguration = v.storage;
        if (d.mpn && d.mpn !== match.manufacturerPartNumber) ch.manufacturerPartNumber = d.mpn;
        if (v.gtin && v.gtin !== match.barcodeGtin) {
          if (match.barcodeGtin) {
            p.issues.push({
              field: "gtin",
              message: `Variant "${match.variantName}" already has GTIN ${match.barcodeGtin}`,
            });
            continue;
          }
          ch.barcodeGtin = v.gtin;
        }
        p.variantChanges = ch;
      } else {
        p.createVariant = true;
      }
    }
    if (!(p.productId && L.sourceRecords.has(`${p.productId}|${source.id}`)))
      p.addSourceRecord = true;
    p.action = "update"; // refined below
  }

  // Pass 2: specification values, decided per product across all of its rows in the file.
  const groups = new Map<string, number[]>();
  plans.forEach((p, i) => {
    if (p.action !== "update" || !p.data) return;
    const k = p.productId ?? p.groupKey!;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  for (const [key, idxs] of groups) {
    const first = plans[idxs[0]!]!;
    const defs = L.defs.get(first.categoryId!) ?? [];
    const productId = first.productId;
    const existingVariants = productId ? (L.variants.get(productId) ?? []) : [];
    const specRows = productId ? (L.specs.get(productId) ?? []) : [];
    const productValue = (defId: string) =>
      specRows.find((s) => s.specificationDefinitionId === defId && s.variantId === null);
    const override = (defId: string, variantId: string) =>
      specRows.find((s) => s.specificationDefinitionId === defId && s.variantId === variantId);
    // Variants of this product after the import: existing ones plus new ones from the file.
    const variantKeys = new Set<string>([...existingVariants.map((v) => v.id)]);
    const rowVariantKey = (p: ProductRowPlan) =>
      p.variantId ??
      (p.data!.variant ? `new:${p.data!.variant.code ?? slugify(p.data!.variant.name)}` : null);
    for (const i of idxs) {
      const k = rowVariantKey(plans[i]!);
      if (k) variantKeys.add(k);
    }
    const productScopeWritten = new Set<string>();

    for (const def of defs) {
      const perRow = idxs
        .map((i) => ({ i, raw: plans[i]!.data!.specs[def.key] }))
        .filter((x): x is { i: number; raw: string } => x.raw !== undefined)
        .map((x) => ({ ...x, value: parseSpecificationValue(def, x.raw) }));
      if (!perRow.length) continue;
      // Product scope when every variant gets the same value from this file and no existing
      // override would keep shadowing it; otherwise each row writes its variant's own value.
      const covered = new Map<string, string>();
      for (const x of perRow) {
        const k = rowVariantKey(plans[x.i]!);
        if (k) covered.set(k, valueKey(x.value));
      }
      const values = new Set(perRow.map((x) => valueKey(x.value)));
      const v0 = perRow[0]!.value;
      const productScopeOk =
        values.size === 1 &&
        [...variantKeys].every((k) => covered.get(k) === valueKey(v0)) &&
        existingVariants.every((v) => {
          const o = override(def.id, v.id);
          return !o || sameValue(o, v0);
        });

      for (const x of perRow) {
        const plan = plans[x.i]!;
        const pv = productValue(def.id);
        const ov = plan.variantId ? override(def.id, plan.variantId) : undefined;
        const current = plan.data!.variant ? (ov ?? pv) : pv;
        if (current && sameValue(current, x.value)) continue;
        const scope: "product" | "variant" =
          !plan.data!.variant || productScopeOk ? "product" : "variant";
        if (scope === "product") {
          if (productScopeWritten.has(def.key)) continue;
          productScopeWritten.add(def.key);
        }
        const target = scope === "product" ? pv : ov;
        if (target?.verificationStatus === "verified")
          plan.notes.push(`${def.name}: verified value — the new one goes to the review queue`);
        plan.specWrites.push({ key: def.key, raw: x.raw, scope });
      }
    }
    void key;
  }

  // Final actions.
  for (const p of plans) {
    if (p.issues.length) {
      p.action = "error";
      continue;
    }
    if (p.action !== "update") continue;
    const creates = !p.productId || p.createVariant;
    const changes =
      Object.keys(p.productChanges).length +
      Object.keys(p.variantChanges).length +
      p.specWrites.length +
      (p.addSourceRecord ? 1 : 0);
    if (creates) p.action = "create";
    else if (changes === 0) {
      p.action = "skip";
      p.notes.push("No changes");
    }
    if (!p.productId && p.groupKey) {
      const lead = plans.find((q) => q.groupKey === p.groupKey && q.action === "create");
      if (lead === p) p.notes.unshift("Creates a draft product (queued for review)");
    }
    if (p.createVariant) p.notes.push(`Adds variant "${p.data!.variant!.name}"`);
    const specCount = p.specWrites.length;
    if (specCount) p.notes.push(`${specCount} specification value${specCount === 1 ? "" : "s"}`);
    if (p.productId && Object.keys(p.productChanges).length)
      p.notes.push(`Updates ${Object.keys(p.productChanges).join(", ")}`);
    if (Object.keys(p.variantChanges).length)
      p.notes.push(`Updates variant ${Object.keys(p.variantChanges).join(", ")}`);
  }
  return plans;
}

// ─── Applying a plan ───────────────────────────────────────────────────────────────────

export interface ApplyState {
  /** groupKey → product created earlier in this commit. */
  created: Map<string, string>;
}

/**
 * Applies one planned row through the normal services (validation, audit, verified-value
 * protection). Must run inside a transaction/savepoint (`ctx.db`).
 */
export async function applyProductPlan(
  ctx: ServiceContext,
  p: ProductRowPlan,
  state: ApplyState,
): Promise<{ productId: string; variantId: string | null; reviewItems: number }> {
  const d = p.data!;
  let reviewItems = 0;
  let productId = p.productId ?? (p.groupKey ? state.created.get(p.groupKey) : undefined) ?? null;
  if (!productId) {
    const created = await createProduct(ctx, {
      brandId: p.brandId!,
      categoryId: p.categoryId!,
      name: d.productName,
      modelNumber: d.modelNumber,
      manufacturerPartNumber: d.variant ? null : d.mpn,
      productStatus: d.productStatus ?? "unknown",
      releaseDate: d.releaseDate,
      isDemo: d.isDemo ?? false,
    });
    productId = created.id;
    if (p.groupKey) state.created.set(p.groupKey, productId);
    await createReviewItem(ctx.db, {
      itemType: "new_product",
      entityType: "product",
      entityId: productId,
      createdBy: ctx.actorId,
      payload: { productId, name: d.productName, source: "import" },
    });
    reviewItems++;
  } else if (Object.keys(p.productChanges).length) {
    await updateProduct(ctx, productId, p.productChanges);
  }

  let variantId = p.variantId;
  if (d.variant) {
    if (!variantId) {
      // A variant created by an earlier row of this commit for the same new product.
      const code = d.variant.code ?? slugify(d.variant.name);
      const [existing] = await ctx.db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(
          sql`${productVariants.productId} = ${productId} AND ${productVariants.variantCode} = ${code}`,
        );
      variantId =
        existing?.id ??
        (
          await createProductVariant(ctx, productId, {
            variantName: d.variant.name,
            variantCode: code,
            regionCode: d.variant.regionCode ?? null,
            color: d.variant.color,
            memoryConfiguration: d.variant.memory,
            storageConfiguration: d.variant.storage,
            barcodeGtin: d.variant.gtin,
            manufacturerPartNumber: d.mpn,
          })
        ).id;
    } else if (Object.keys(p.variantChanges).length) {
      await updateProductVariant(ctx, variantId, p.variantChanges);
    }
  }

  for (const w of p.specWrites) {
    const r = await setSpecificationValue(ctx, {
      productId,
      variantId: w.scope === "variant" ? variantId : null,
      key: w.key,
      value: w.raw,
      sourceId: p.sourceId,
      origin: "import",
      verificationStatus: "unverified",
    });
    if (r.outcome === "review_required") reviewItems++;
  }

  if (p.addSourceRecord) {
    const [has] = await ctx.db.execute<{ id: string }>(sql`
      SELECT id FROM product_source_records WHERE product_id = ${productId} AND variant_id IS NULL AND source_id = ${p.sourceId!}`);
    if (!has) {
      await addSourceRecord(ctx, {
        productId,
        sourceId: p.sourceId!,
        sourceUrl: d.sourceUrl,
        retrievedAt: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return { productId, variantId, reviewItems };
}
