import { formatSpecValue } from "@/lib/format";

export type Direction = "higher_is_better" | "lower_is_better" | "none";

export interface CompareDefinition {
  id: string;
  key: string;
  name: string;
  dataType: string;
  canonicalUnit: string | null;
  comparisonDirection: Direction;
  groupKey: string | null;
  groupName: string | null;
}

export interface CompareValue {
  specificationDefinitionId: string;
  valueText: string | null;
  valueNumeric: number | string | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: string[] | null;
  sourceId: string | null;
}

export interface CompareCell {
  /** null = no value -> "Not available" (distinct from a boolean "No"). */
  display: string | null;
  /** Marked as the better value for this row (only where a direction is meaningful). */
  better: boolean;
  /** The value's source is the manufacturer: a claim, not an independent measurement. */
  manufacturerClaim: boolean;
}

export interface CompareRow {
  key: string;
  label: string;
  direction: Direction;
  /** Known values differ, or some products have a value and others do not. */
  differs: boolean;
  cells: CompareCell[];
}

export interface CompareGroup {
  key: string;
  name: string;
  rows: CompareRow[];
}

/** A comparable identity for equality ("1000" GB and 1000 GB are the same value). */
function identity(def: CompareDefinition, v: CompareValue | undefined): string | null {
  if (!v) return null;
  if (v.valueBoolean !== null) return `b:${v.valueBoolean}`;
  if (v.valueNumeric !== null) return `n:${Number(v.valueNumeric)}`;
  if (v.valueDate !== null) return `d:${v.valueDate}`;
  if (v.valueJson !== null) return `j:${JSON.stringify(v.valueJson)}`;
  return v.valueText === null ? null : `t:${v.valueText.trim().toLowerCase()}`;
}

/** Orderable number for direction-aware rows (numbers, dates, booleans). */
function magnitude(v: CompareValue | undefined): number | null {
  if (!v) return null;
  if (v.valueNumeric !== null) return Number(v.valueNumeric);
  if (v.valueDate !== null) return Date.parse(`${v.valueDate}T00:00:00Z`);
  if (v.valueBoolean !== null) return v.valueBoolean ? 1 : 0;
  return null;
}

/**
 * Builds grouped comparison rows. Values are already in each definition's canonical unit, so
 * they compare directly. A "better" marker is set per row only when the definition has a
 * comparison direction and at least two known values differ — there is never an overall winner.
 */
export function buildComparisonGroups(
  defs: CompareDefinition[],
  productIds: string[],
  values: Map<string, CompareValue[]>,
  manufacturerSourceIds: Set<string>,
): CompareGroup[] {
  const lookup = new Map<string, Map<string, CompareValue>>();
  for (const pid of productIds) {
    lookup.set(pid, new Map((values.get(pid) ?? []).map((v) => [v.specificationDefinitionId, v])));
  }
  const groups: CompareGroup[] = [];
  for (const def of defs) {
    const vals = productIds.map((pid) => lookup.get(pid)!.get(def.id));
    if (vals.every((v) => !v)) continue; // nobody has data: the row would only say "Not available"
    const ids = vals.map((v) => identity(def, v));
    const known = ids.filter((x): x is string => x !== null);
    const differs = new Set(known).size > 1 || (known.length > 0 && known.length < ids.length);

    let best: number | null = null;
    if (def.comparisonDirection !== "none") {
      const mags = vals.map(magnitude).filter((m): m is number => m !== null);
      if (mags.length >= 2 && new Set(mags).size > 1) {
        best =
          def.comparisonDirection === "higher_is_better" ? Math.max(...mags) : Math.min(...mags);
      }
    }

    const row: CompareRow = {
      key: def.key,
      label: def.name,
      direction: def.comparisonDirection,
      differs,
      cells: vals.map((v) => ({
        display: formatSpecValue(def, v),
        better: best !== null && magnitude(v) === best,
        manufacturerClaim: Boolean(v?.sourceId && manufacturerSourceIds.has(v.sourceId)),
      })),
    };
    const gKey = def.groupKey ?? "other";
    let g = groups.find((x) => x.key === gKey);
    if (!g) {
      g = { key: gKey, name: def.groupName ?? "Other", rows: [] };
      groups.push(g);
    }
    g.rows.push(row);
  }
  return groups;
}

/**
 * The deepest category every product belongs to (its rows define the comparison). Each chain
 * is root-first. Returns null when the products do not share a top-level category.
 */
export function lowestCommonCategory(chains: string[][]): string | null {
  if (chains.length === 0 || chains.some((c) => c.length === 0)) return null;
  let common: string | null = null;
  for (let depth = 0; ; depth++) {
    const at = chains.map((c) => c[depth]);
    if (at.some((x) => x === undefined) || new Set(at).size !== 1) break;
    common = at[0]!;
  }
  return common;
}
