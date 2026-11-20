import { describe, expect, it } from "vitest";
import {
  buildComparisonGroups,
  lowestCommonCategory,
  type CompareDefinition,
  type CompareValue,
} from "@/modules/comparisons/rows";
import { canonicalSlugs, comparisonPath, parseComparisonParam } from "@/modules/comparisons/url";

describe("comparison URLs", () => {
  it("parses and canonicalises alphabetically", () => {
    expect(parseComparisonParam("aera-7-pro-vs-aera-6-pro")).toEqual({
      ok: true,
      slugs: ["aera-7-pro", "aera-6-pro"],
      canonical: ["aera-6-pro", "aera-7-pro"],
      isCanonical: false,
    });
    expect(parseComparisonParam("a-vs-b-vs-c")).toMatchObject({ ok: true, isCanonical: true });
  });

  it("rejects fewer than 2, more than 4, duplicates and invalid slugs", () => {
    expect(parseComparisonParam("aera-7-pro")).toEqual({ ok: false, reason: "too_few" });
    expect(parseComparisonParam("a-vs-b-vs-c-vs-d-vs-e")).toEqual({
      ok: false,
      reason: "too_many",
    });
    expect(parseComparisonParam("a-vs-a")).toEqual({ ok: false, reason: "duplicate" });
    expect(parseComparisonParam("Aera-vs-b")).toEqual({ ok: false, reason: "invalid_slug" });
    expect(parseComparisonParam("a--vs-b")).toEqual({ ok: false, reason: "invalid_slug" });
  });

  it("builds canonical paths, falling back to the picker outside 2–4", () => {
    expect(comparisonPath(["x9-3d", "forge-8", "x7"])).toBe("/compare/forge-8-vs-x7-vs-x9-3d");
    expect(comparisonPath(["x7"])).toBe("/compare");
    expect(comparisonPath(["a", "b", "c", "d", "e"])).toBe("/compare");
    expect(canonicalSlugs(["b", "a", "b"])).toEqual(["a", "b"]);
  });

  it("round-trips: the canonical path of any order parses as canonical", () => {
    const path = comparisonPath(["ridge-7800", "tessel-12", "ridge-6800"]);
    expect(parseComparisonParam(path.replace("/compare/", ""))).toMatchObject({
      ok: true,
      isCanonical: true,
    });
  });
});

const def = (key: string, over: Partial<CompareDefinition> = {}): CompareDefinition => ({
  id: key,
  key,
  name: key,
  dataType: "integer",
  canonicalUnit: null,
  comparisonDirection: "none",
  groupKey: "main",
  groupName: "Main",
  ...over,
});

const val = (definition: string, over: Partial<CompareValue>): CompareValue => ({
  specificationDefinitionId: definition,
  valueText: null,
  valueNumeric: null,
  valueBoolean: null,
  valueDate: null,
  valueJson: null,
  sourceId: null,
  ...over,
});

describe("buildComparisonGroups", () => {
  const defs = [
    def("battery", { canonicalUnit: "mAh", comparisonDirection: "higher_is_better" }),
    def("weight", {
      dataType: "decimal",
      canonicalUnit: "kg",
      comparisonDirection: "lower_is_better",
      groupKey: "build",
      groupName: "Build",
    }),
    def("storage", { canonicalUnit: "GB", comparisonDirection: "higher_is_better" }),
    def("wireless", { dataType: "boolean", comparisonDirection: "higher_is_better" }),
    def("chip", { dataType: "text" }),
    def("unused"),
  ];
  const values = new Map([
    [
      "a",
      [
        val("battery", { valueNumeric: 5000 }),
        val("weight", { valueNumeric: "1.39" }),
        val("storage", { valueNumeric: 1000 }),
        val("wireless", { valueBoolean: false }),
        val("chip", { valueText: "N3", sourceId: "maker" }),
      ],
    ],
    [
      "b",
      [
        val("battery", { valueNumeric: 4800 }),
        val("weight", { valueNumeric: 1.42 }),
        val("storage", { valueNumeric: "1000.000" }),
        val("chip", { valueText: "n3 " }),
      ],
    ],
  ]);
  const groups = buildComparisonGroups(defs, ["a", "b"], values, new Set(["maker"]));
  const rows = Object.fromEntries(groups.flatMap((g) => g.rows).map((r) => [r.key, r]));

  it("groups rows and drops rows nobody has data for", () => {
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.key)])).toEqual([
      ["main", ["battery", "storage", "wireless", "chip"]],
      ["build", ["weight"]],
    ]);
  });

  it("marks the better value per row according to direction", () => {
    expect(rows.battery!.cells.map((c) => c.better)).toEqual([true, false]);
    expect(rows.weight!.cells.map((c) => c.better)).toEqual([true, false]); // lower is better
  });

  it("never marks a better value when values are equal, after unit normalisation", () => {
    expect(rows.storage!.differs).toBe(false);
    expect(rows.storage!.cells.map((c) => c.better)).toEqual([false, false]);
    expect(rows.storage!.cells.map((c) => c.display)).toEqual(["1 TB", "1 TB"]);
  });

  it("treats a missing value as a difference and never as 'better' or 'No'", () => {
    expect(rows.wireless!.differs).toBe(true);
    expect(rows.wireless!.cells.map((c) => c.display)).toEqual(["No", null]);
    expect(rows.wireless!.cells.map((c) => c.better)).toEqual([false, false]); // only one known value
  });

  it("compares text case- and whitespace-insensitively and flags manufacturer claims", () => {
    expect(rows.chip!.differs).toBe(false);
    expect(rows.chip!.cells.map((c) => c.manufacturerClaim)).toEqual([true, false]);
  });
});

describe("lowestCommonCategory", () => {
  it("finds the deepest shared category, or null across top-level categories", () => {
    expect(lowestCommonCategory([["laptops"], ["laptops", "gaming"]])).toBe("laptops");
    expect(
      lowestCommonCategory([
        ["laptops", "gaming"],
        ["laptops", "gaming"],
      ]),
    ).toBe("gaming");
    expect(lowestCommonCategory([["phones"], ["laptops"]])).toBeNull();
    expect(lowestCommonCategory([])).toBeNull();
  });
});
