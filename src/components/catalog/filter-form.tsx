import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getUnit } from "@/lib/units";
import type { CatalogFilters, FilterableDefinition, SpecFilter } from "@/modules/catalog/filters";
import type { NumericRange } from "@/modules/catalog/service";

export interface FilterFormProps {
  path: string;
  filters: CatalogFilters;
  definitions: FilterableDefinition[];
  ranges: Map<string, NumericRange>;
  brands: { slug: string; name: string; productCount: number }[];
  /** Single currency of the selected market; null hides the price filter (SPEC §6). */
  priceCurrency: string | null;
  categories?: { slug: string; name: string }[];
  selectedCategory?: string | null;
  showQuery?: boolean;
}

const fieldset = "flex flex-col gap-2 border-t pt-4";
const legend = "label-caps mb-1";
const input = "h-11 w-full min-w-0 border bg-background px-2.5 text-sm sm:h-9";

function unitLabel(symbol: string | null) {
  if (!symbol) return "";
  return getUnit(symbol)?.display ?? symbol;
}

function specOf(filters: CatalogFilters, key: string): SpecFilter | undefined {
  return filters.specs.find((s) => s.key === key);
}

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

function Fields({ idp, ...p }: FilterFormProps & { idp: string }) {
  return (
    <>
      {p.showQuery ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idp}-q`} className={legend}>
            Name or model
          </label>
          <input
            id={`${idp}-q`}
            name="q"
            type="search"
            defaultValue={p.filters.q ?? ""}
            maxLength={100}
            className={input}
          />
        </div>
      ) : null}

      {p.categories?.length ? (
        <div className={fieldset}>
          <label htmlFor={`${idp}-category`} className={legend}>
            Category
          </label>
          <select
            id={`${idp}-category`}
            name="category"
            defaultValue={p.selectedCategory ?? ""}
            className={input}
          >
            <option value="">All categories</option>
            {p.categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {p.brands.length > 1 ? (
        <fieldset className={fieldset}>
          <legend className={legend}>Brand</legend>
          {p.brands.map((b) => (
            <label key={b.slug} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="brand"
                value={b.slug}
                defaultChecked={p.filters.brandSlugs.includes(b.slug)}
                className="size-4 accent-[var(--primary)]"
              />
              <span className="flex-1">{b.name}</span>
              <span className="text-xs text-muted-foreground">{b.productCount}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className={fieldset}>
        <label htmlFor={`${idp}-status`} className={legend}>
          Status
        </label>
        <select
          id={`${idp}-status`}
          name="status"
          defaultValue={p.filters.status ?? ""}
          className={input}
        >
          <option value="">Any status</option>
          <option value="announced">Announced</option>
          <option value="active">Available</option>
          <option value="discontinued">Discontinued</option>
        </select>
      </div>

      {p.priceCurrency ? (
        <fieldset className={fieldset}>
          <legend className={legend}>Lowest current price ({p.priceCurrency})</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Min
              <input
                name="price.min"
                inputMode="decimal"
                defaultValue={p.filters.priceMin ?? ""}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Max
              <input
                name="price.max"
                inputMode="decimal"
                defaultValue={p.filters.priceMax ?? ""}
                className={input}
              />
            </label>
          </div>
        </fieldset>
      ) : null}

      {p.definitions.map((d) => {
        const current = specOf(p.filters, d.key);
        if (d.dataType === "integer" || d.dataType === "decimal") {
          const r = p.ranges.get(d.id);
          const unit = unitLabel(d.canonicalUnit);
          return (
            <fieldset key={d.key} className={fieldset}>
              <legend className={legend}>
                {d.name}
                {unit ? ` (${unit})` : ""}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Min
                  <input
                    name={`s.${d.key}.min`}
                    inputMode="decimal"
                    placeholder={r ? nf.format(r.min) : undefined}
                    defaultValue={current?.kind === "range" ? (current.min ?? "") : ""}
                    className={input}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Max
                  <input
                    name={`s.${d.key}.max`}
                    inputMode="decimal"
                    placeholder={r ? nf.format(r.max) : undefined}
                    defaultValue={current?.kind === "range" ? (current.max ?? "") : ""}
                    className={input}
                  />
                </label>
              </div>
            </fieldset>
          );
        }
        if (d.dataType === "enum" || d.dataType === "multi_select") {
          const options = ((d.validationRules as { options?: string[] })?.options ?? []).slice(
            0,
            30,
          );
          const selected = current?.kind === "options" ? current.values : [];
          return (
            <fieldset key={d.key} className={fieldset}>
              <legend className={legend}>{d.name}</legend>
              {options.map((o) => (
                <label key={o} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`s.${d.key}`}
                    value={o}
                    defaultChecked={selected.includes(o)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {o}
                </label>
              ))}
            </fieldset>
          );
        }
        if (d.dataType === "boolean") {
          const value = current?.kind === "boolean" ? (current.value ? "yes" : "no") : "";
          return (
            <div key={d.key} className={fieldset}>
              <label htmlFor={`${idp}-${d.key}`} className={legend}>
                {d.name}
              </label>
              <select
                id={`${idp}-${d.key}`}
                name={`s.${d.key}`}
                defaultValue={value}
                className={input}
              >
                <option value="">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          );
        }
        return null;
      })}

      {p.filters.sort !== "newest" ? (
        <input type="hidden" name="sort" value={p.filters.sort} />
      ) : null}
      <div className="flex items-center gap-3 border-t pt-4">
        <Button type="submit" className="blueprint flex-1">
          Apply filters
        </Button>
        <Link href={p.path} className="text-sm text-primary hover:text-primary-active">
          Clear
        </Link>
      </div>
    </>
  );
}

/**
 * Category-specific filters as a plain GET form: state lives in the URL (shareable, works
 * without JavaScript). Desktop shows a sidebar; phones get a collapsible panel.
 */
export function FilterForm(props: FilterFormProps) {
  const active =
    props.filters.brandSlugs.length +
    props.filters.specs.length +
    (props.filters.status ? 1 : 0) +
    (props.filters.priceMin !== null || props.filters.priceMax !== null ? 1 : 0) +
    (props.filters.q ? 1 : 0);
  return (
    <>
      <details className="border lg:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 font-medium">
          <SlidersHorizontal aria-hidden="true" strokeWidth={1.5} className="size-4" />
          Filters{active ? ` (${active} active)` : ""}
        </summary>
        <form
          action={props.path}
          method="get"
          className="flex flex-col gap-4 border-t p-4"
          aria-label="Filters"
        >
          <Fields {...props} idp="m" />
        </form>
      </details>
      <form
        action={props.path}
        method="get"
        className="hidden flex-col gap-4 lg:flex"
        aria-label="Filters"
      >
        <h2 className="text-xl">Filters</h2>
        <Fields {...props} idp="d" />
      </form>
    </>
  );
}
