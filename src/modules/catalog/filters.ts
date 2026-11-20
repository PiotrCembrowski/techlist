import { parseLocaleNumber } from "@/lib/units";
import { slugSchema } from "@/lib/validation";

/**
 * URL format (filter state lives in the query string, SPEC §7.4):
 *   q=…                      free text
 *   brand=halden&brand=novik brand slugs (repeatable)
 *   status=active            product status
 *   sort=newest|name|release_date|price_asc
 *   page=2
 *   price.min=… price.max=…  only honoured when a single-currency market is selected
 *   s.<key>.min / s.<key>.max  numeric spec range, in the definition's canonical unit
 *   s.<key>=IPS&s.<key>=OLED   enum / multi-select options (any of)
 *   s.<key>=yes|no             boolean spec
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const SORTS = ["newest", "name", "release_date", "price_asc"] as const;
export type CatalogSort = (typeof SORTS)[number];
export const PRODUCT_STATUSES = ["announced", "active", "discontinued", "unknown"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface FilterableDefinition {
  id: string;
  key: string;
  name: string;
  dataType: string;
  canonicalUnit: string | null;
  validationRules: unknown;
}

export type SpecFilter =
  | { definitionId: string; key: string; kind: "range"; min?: number; max?: number }
  | { definitionId: string; key: string; kind: "options"; values: string[] }
  | { definitionId: string; key: string; kind: "boolean"; value: boolean };

export interface CatalogFilters {
  q: string | null;
  brandSlugs: string[];
  status: ProductStatus | null;
  sort: CatalogSort;
  page: number;
  priceMin: number | null;
  priceMax: number | null;
  specs: SpecFilter[];
}

export const MAX_PAGE = 500;

function all(params: RawSearchParams, key: string): string[] {
  const v = params[key];
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean);
}

function first(params: RawSearchParams, key: string): string | null {
  return all(params, key)[0] ?? null;
}

function num(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  try {
    const n = parseLocaleNumber(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function optionsOf(def: FilterableDefinition): string[] {
  const rules = def.validationRules as { options?: unknown } | null;
  return Array.isArray(rules?.options)
    ? rules.options.filter((o): o is string => typeof o === "string")
    : [];
}

/** Parses the query string. Unknown or invalid values are dropped, never errors. */
export function parseCatalogFilters(
  params: RawSearchParams,
  defs: FilterableDefinition[] = [],
): CatalogFilters {
  const q = first(params, "q");
  const sortRaw = first(params, "sort");
  const statusRaw = first(params, "status");
  const pageRaw = Number(first(params, "page") ?? "1");
  const priceMin = num(first(params, "price.min"));
  const priceMax = num(first(params, "price.max"));

  const specs: SpecFilter[] = [];
  for (const def of defs) {
    const base = `s.${def.key}`;
    if (def.dataType === "integer" || def.dataType === "decimal") {
      const min = num(first(params, `${base}.min`));
      const max = num(first(params, `${base}.max`));
      if (min !== undefined || max !== undefined) {
        specs.push({
          definitionId: def.id,
          key: def.key,
          kind: "range",
          ...(min !== undefined && { min }),
          ...(max !== undefined && { max }),
        });
      }
    } else if (def.dataType === "enum" || def.dataType === "multi_select") {
      const options = optionsOf(def);
      const values = [
        ...new Set(
          all(params, base)
            .map((v) => options.find((o) => o.toLowerCase() === v.toLowerCase()))
            .filter((v): v is string => !!v),
        ),
      ];
      if (values.length)
        specs.push({ definitionId: def.id, key: def.key, kind: "options", values });
    } else if (def.dataType === "boolean") {
      const v = first(params, base)?.toLowerCase();
      if (v === "yes" || v === "no")
        specs.push({ definitionId: def.id, key: def.key, kind: "boolean", value: v === "yes" });
    }
  }

  return {
    q: q ? q.slice(0, 100) : null,
    brandSlugs: [
      ...new Set(all(params, "brand").filter((s) => slugSchema.safeParse(s).success)),
    ].slice(0, 20),
    status: (PRODUCT_STATUSES as readonly string[]).includes(statusRaw ?? "")
      ? (statusRaw as ProductStatus)
      : null,
    sort: (SORTS as readonly string[]).includes(sortRaw ?? "")
      ? (sortRaw as CatalogSort)
      : "newest",
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, MAX_PAGE) : 1,
    priceMin: priceMin !== undefined && priceMin >= 0 ? priceMin : null,
    priceMax: priceMax !== undefined && priceMax >= 0 ? priceMax : null,
    specs,
  };
}

/** True when the URL narrows the listing (used for `noindex, follow` + canonical to the unfiltered page). */
export function isFiltered(f: CatalogFilters): boolean {
  return !!(
    f.q ||
    f.brandSlugs.length ||
    f.status ||
    f.priceMin !== null ||
    f.priceMax !== null ||
    f.specs.length ||
    f.sort !== "newest"
  );
}

/** Serialise filters back into a query string (stable order, so links are canonical). */
export function catalogQueryString(f: Partial<CatalogFilters>): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  for (const b of f.brandSlugs ?? []) p.append("brand", b);
  if (f.status) p.set("status", f.status);
  if (f.priceMin != null) p.set("price.min", String(f.priceMin));
  if (f.priceMax != null) p.set("price.max", String(f.priceMax));
  for (const s of f.specs ?? []) {
    if (s.kind === "range") {
      if (s.min !== undefined) p.set(`s.${s.key}.min`, String(s.min));
      if (s.max !== undefined) p.set(`s.${s.key}.max`, String(s.max));
    } else if (s.kind === "options") {
      for (const v of s.values) p.append(`s.${s.key}`, v);
    } else {
      p.set(`s.${s.key}`, s.value ? "yes" : "no");
    }
  }
  if (f.sort && f.sort !== "newest") p.set("sort", f.sort);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** True when a GET filter form submitted empty fields; pages then redirect to the clean URL. */
export function hasEmptyParams(raw: RawSearchParams): boolean {
  return Object.values(raw).some((v) =>
    Array.isArray(v) ? v.some((x) => x.trim() === "") : v !== undefined && v.trim() === "",
  );
}
