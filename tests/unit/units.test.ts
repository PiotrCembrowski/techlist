import { describe, expect, it } from "vitest";
import {
  convert,
  formatQuantity,
  parseLocaleNumber,
  parseQuantity,
  parseUnitless,
  UnitError,
} from "@/lib/units";

describe("parseQuantity", () => {
  it.each([
    ["1 TB", "GB", 1000],
    ["512GB", "GB", 512],
    ["2 TiB", "GB", 2199.023255552],
    ['15.6"', "in", 15.6],
    ["15.6″", "in", 15.6],
    ["14.2 inches", "in", 14.2],
    ["1420 g", "kg", 1.42],
    ["1,39 kg", "kg", 1.39],
    ["5 000 mAh", "mAh", 5000],
    ["5,000 mAh", "mAh", 5000],
    ["4000 MHz", "GHz", 4],
    ["28.5 cm", "mm", 285],
    ["256-bit", "bit", 256],
    ["0.25 kg", "g", 250],
    ["350 cd/m²", "nits", 350],
    ["90 min", "h", 1.5],
    ["1.5 lb", "kg", 0.680388555],
  ])("%s -> %s", (raw, unit, expected) => {
    expect(parseQuantity(raw, unit)).toBeCloseTo(expected, 6);
  });

  it("takes a bare number as already canonical", () => {
    expect(parseQuantity("16", "GB")).toBe(16);
    expect(parseQuantity(16, "GB")).toBe(16);
  });

  it("rejects incompatible units", () => {
    expect(() => parseQuantity("15 kg", "GB")).toThrow(UnitError);
    expect(() => parseQuantity("3 GHz", "W")).toThrow(/Incompatible unit/);
  });

  it("rejects unknown units and garbage", () => {
    expect(() => parseQuantity("12 furlongs", "mm")).toThrow(/Unknown unit/);
    expect(() => parseQuantity("lots", "GB")).toThrow(UnitError);
    expect(() => parseQuantity("1 TB", "parsecs")).toThrow(/canonical/);
  });

  it("uses decimal SI for storage", () => {
    expect(convert(1, "TB", "GB")).toBe(1000);
    expect(convert(1, "GiB", "MB")).toBe(1073.741824);
  });
});

describe("parseLocaleNumber", () => {
  it.each([
    ["1.39", 1.39],
    ["1,39", 1.39],
    ["1.234,5", 1234.5],
    ["1,234.5", 1234.5],
    ["1 234 567", 1234567],
    ["-3", -3],
  ])("%s", (raw, n) => expect(parseLocaleNumber(raw)).toBe(n));

  it("rejects non-numbers", () => {
    expect(() => parseLocaleNumber("1.2.3")).toThrow(UnitError);
    expect(() => parseLocaleNumber("")).toThrow(UnitError);
  });
});

describe("parseUnitless / formatQuantity", () => {
  it("refuses a unit where none is expected", () => {
    expect(parseUnitless("16")).toBe(16);
    expect(() => parseUnitless("16 GB")).toThrow(UnitError);
  });
  it("formats with the unit's display symbol", () => {
    expect(formatQuantity(14.2, "in")).toBe("14.2″");
    expect(formatQuantity(5000, "mAh")).toBe("5,000 mAh");
    expect(formatQuantity(3, null)).toBe("3");
  });
});
