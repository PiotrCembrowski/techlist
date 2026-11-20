import { describe, expect, it } from "vitest";
import {
  catalogQueryString,
  hasEmptyParams,
  isFiltered,
  parseCatalogFilters,
  type FilterableDefinition,
} from "@/modules/catalog/filters";

const defs: FilterableDefinition[] = [
  {
    id: "d-ram",
    key: "ram",
    name: "RAM",
    dataType: "integer",
    canonicalUnit: "GB",
    validationRules: {},
  },
  {
    id: "d-panel",
    key: "panel_type",
    name: "Panel",
    dataType: "enum",
    canonicalUnit: null,
    validationRules: { options: ["IPS", "OLED", "VA"] },
  },
  {
    id: "d-conn",
    key: "connectivity",
    name: "Connectivity",
    dataType: "multi_select",
    canonicalUnit: null,
    validationRules: { options: ["Bluetooth", "USB-C audio"] },
  },
  {
    id: "d-hdr",
    key: "hdr_support",
    name: "HDR",
    dataType: "boolean",
    canonicalUnit: null,
    validationRules: {},
  },
  {
    id: "d-cpu",
    key: "processor",
    name: "Processor",
    dataType: "text",
    canonicalUnit: null,
    validationRules: {},
  },
];

describe("parseCatalogFilters", () => {
  it("parses every filter kind from the query string", () => {
    const f = parseCatalogFilters(
      {
        q: " aera ",
        brand: ["novik", "halden", "novik"],
        status: "active",
        sort: "name",
        page: "3",
        "price.min": "1 000",
        "price.max": "4500,50",
        "s.ram.min": "16",
        "s.ram.max": "32",
        "s.panel_type": ["oled", "IPS", "CRT"],
        "s.connectivity": "Bluetooth",
        "s.hdr_support": "yes",
        "s.processor": "anything",
      },
      defs,
    );
    expect(f).toMatchObject({
      q: "aera",
      brandSlugs: ["novik", "halden"],
      status: "active",
      sort: "name",
      page: 3,
      priceMin: 1000,
      priceMax: 4500.5,
    });
    expect(f.specs).toEqual([
      { definitionId: "d-ram", key: "ram", kind: "range", min: 16, max: 32 },
      { definitionId: "d-panel", key: "panel_type", kind: "options", values: ["OLED", "IPS"] },
      { definitionId: "d-conn", key: "connectivity", kind: "options", values: ["Bluetooth"] },
      { definitionId: "d-hdr", key: "hdr_support", kind: "boolean", value: true },
    ]);
  });

  it("drops invalid values instead of failing", () => {
    const f = parseCatalogFilters(
      {
        brand: "Bad Slug!",
        status: "sold",
        sort: "rating",
        page: "-2",
        "price.min": "abc",
        "s.ram.min": "lots",
        "s.hdr_support": "maybe",
        "s.unknown": "1",
      },
      defs,
    );
    expect(f).toMatchObject({
      brandSlugs: [],
      status: null,
      sort: "newest",
      page: 1,
      priceMin: null,
      specs: [],
    });
    expect(parseCatalogFilters({ page: "99999" }).page).toBe(500);
  });

  it("only recognises spec keys of the given definitions (no GPU filters on headphone pages)", () => {
    expect(parseCatalogFilters({ "s.vram.min": "8" }, defs).specs).toEqual([]);
  });

  it("round-trips through the canonical query string", () => {
    const raw = {
      brand: ["halden"],
      "s.ram.min": "16",
      "s.panel_type": ["OLED"],
      "s.hdr_support": "no",
      sort: "release_date",
      page: "2",
    };
    const f = parseCatalogFilters(raw, defs);
    const qs = catalogQueryString(f);
    expect(qs).toBe(
      "?brand=halden&s.ram.min=16&s.panel_type=OLED&s.hdr_support=no&sort=release_date&page=2",
    );
    const again = parseCatalogFilters(Object.fromEntries(new URLSearchParams(qs).entries()), defs);
    expect(again).toEqual(f);
  });

  it("knows when a listing is filtered (noindex + canonical to the unfiltered page)", () => {
    expect(isFiltered(parseCatalogFilters({}, defs))).toBe(false);
    expect(isFiltered(parseCatalogFilters({ page: "2" }, defs))).toBe(false);
    expect(isFiltered(parseCatalogFilters({ "s.hdr_support": "yes" }, defs))).toBe(true);
    expect(isFiltered(parseCatalogFilters({ sort: "name" }, defs))).toBe(true);
  });

  it("detects empty submitted form fields", () => {
    expect(hasEmptyParams({ "s.ram.min": "", brand: "x" })).toBe(true);
    expect(hasEmptyParams({ brand: ["a", " "] })).toBe(true);
    expect(hasEmptyParams({ brand: "a" })).toBe(false);
  });
});
