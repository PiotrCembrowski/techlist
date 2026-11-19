import { describe, expect, it } from "vitest";
import { ValidationError } from "@/modules/_shared/errors";
import {
  assertDefinitionConsistent,
  parseSpecificationValue,
  sameValue,
  type DefinitionShape,
} from "@/modules/specifications/parse";

const def = (over: Partial<DefinitionShape>): DefinitionShape => ({
  key: "k",
  name: "K",
  dataType: "text",
  canonicalUnit: null,
  validationRules: {},
  ...over,
});

describe("parseSpecificationValue", () => {
  it("stores numbers in the canonical unit", () => {
    expect(
      parseSpecificationValue(def({ dataType: "integer", canonicalUnit: "GB" }), "1 TB")
        .valueNumeric,
    ).toBe(1000);
    expect(
      parseSpecificationValue(def({ dataType: "decimal", canonicalUnit: "kg" }), "1390 g")
        .valueNumeric,
    ).toBe(1.39);
  });
  it("rejects non-integers for integer specs and incompatible units", () => {
    expect(() =>
      parseSpecificationValue(def({ dataType: "integer", canonicalUnit: "GB" }), "1.5 GB"),
    ).toThrow(ValidationError);
    expect(() =>
      parseSpecificationValue(def({ dataType: "integer", canonicalUnit: "GB" }), "3 kg"),
    ).toThrow(/Incompatible/);
  });
  it("applies min/max/step", () => {
    const d = def({
      dataType: "decimal",
      canonicalUnit: "in",
      validationRules: { min: 3, max: 10, step: 0.1 },
    });
    expect(parseSpecificationValue(d, "6.7 in").valueNumeric).toBe(6.7);
    expect(() => parseSpecificationValue(d, "12 in")).toThrow(/at most 10/);
    expect(() => parseSpecificationValue(d, "2 in")).toThrow(/at least 3/);
    expect(() => parseSpecificationValue(d, "6.75 in")).toThrow(/multiple of 0.1/);
  });
  it("parses booleans and keeps No distinct from missing", () => {
    const d = def({ dataType: "boolean" });
    expect(parseSpecificationValue(d, "no")).toMatchObject({
      valueBoolean: false,
      valueText: null,
    });
    expect(parseSpecificationValue(d, true).valueBoolean).toBe(true);
    expect(() => parseSpecificationValue(d, "maybe")).toThrow(ValidationError);
  });
  it("validates real dates", () => {
    const d = def({ dataType: "date" });
    expect(parseSpecificationValue(d, "2026-03-04").valueDate).toBe("2026-03-04");
    expect(() => parseSpecificationValue(d, "2026-02-30")).toThrow(/not a real date/);
    expect(() => parseSpecificationValue(d, "04/03/2026")).toThrow(/YYYY-MM-DD/);
  });
  it("matches enum options case-insensitively to the canonical spelling", () => {
    const d = def({ dataType: "enum", validationRules: { options: ["IPS", "OLED"] } });
    expect(parseSpecificationValue(d, "oled").valueText).toBe("OLED");
    expect(() => parseSpecificationValue(d, "CRT")).toThrow(/not one of/);
  });
  it("normalises multi_select to option order without duplicates", () => {
    const d = def({
      dataType: "multi_select",
      validationRules: { options: ["Bluetooth", "USB-C audio", "3.5 mm jack"] },
    });
    expect(parseSpecificationValue(d, "3.5 mm jack; bluetooth; Bluetooth").valueJson).toEqual([
      "Bluetooth",
      "3.5 mm jack",
    ]);
    expect(parseSpecificationValue(d, ["USB-C audio"]).valueJson).toEqual(["USB-C audio"]);
  });
  it("enforces text maxLength and rejects empty input", () => {
    const d = def({ dataType: "text", validationRules: { maxLength: 5 } });
    expect(() => parseSpecificationValue(d, "too long")).toThrow(/at most 5/);
    expect(() => parseSpecificationValue(d, "  ")).toThrow(/empty/);
  });
  it("compares values", () => {
    const d = def({ dataType: "integer", canonicalUnit: "GB" });
    expect(sameValue(parseSpecificationValue(d, "1 TB"), parseSpecificationValue(d, "1000"))).toBe(
      true,
    );
  });
});

describe("assertDefinitionConsistent", () => {
  it.each([
    [{ dataType: "text", canonicalUnit: "GB" }, /only integer\/decimal/],
    [{ dataType: "integer", canonicalUnit: "zorks" }, /unknown unit/],
    [{ dataType: "enum" }, /need options/],
    [{ dataType: "text", validationRules: { options: ["a"] } }, /only allowed for enum/],
    [{ dataType: "text", validationRules: { min: 1 } }, /numeric/],
    [{ dataType: "integer", validationRules: { min: 5, max: 1 } }, /min must be <= max/],
    [{ dataType: "integer", validationRules: { bogus: 1 } }, /Invalid validation rules/],
    [{ dataType: "text", comparisonDirection: "higher_is_better" }, /comparison direction/],
  ] as const)("rejects %o", (over, msg) => {
    expect(() =>
      assertDefinitionConsistent({ ...def(over as Partial<DefinitionShape>), ...(over as object) }),
    ).toThrow(msg);
  });
});
