/**
 * TEST FIXTURES ONLY: every record below is synthetic (fictional brands; GTINs from the GS1
 * restricted-circulation prefix 2, which never identifies a real trade item). Nothing here is, or
 * imitates, real provider output.
 */
import { describe, expect, it } from "vitest";
import { displayGtin, normalizeGtin, partitionGtins, toGtin14 } from "@/lib/gtin";
import { gtinCheckDigit } from "@/lib/validation";
import { TARGET_CATEGORIES, variantKeysFor } from "@/modules/import-core/catalog-config";
import {
  brandKey,
  modelKey,
  nameKey,
  normalizeIsoDate,
  normalizeMpn,
  normalizeText,
  plainText,
} from "@/modules/import-core/identity";
import { attributeConflicts, sameAttribute } from "@/modules/import-core/match";
import {
  normalizeFeatures,
  normalizeRecord,
  type FeatureMapping,
  type MappedDefinition,
  type NormalizeContext,
} from "@/modules/import-core/normalize";
import { decideField, type ProvenanceRow } from "@/modules/import-core/provenance";
import type { ProviderFeature, ProviderRecord } from "@/modules/providers/core/types";
import { assertDefinitionConsistent } from "@/modules/specifications/parse";

const withCheck = (body: string) => `${body}${gtinCheckDigit(body)}`;
const EAN13 = withCheck("200000000001"); // restricted-circulation prefix: fixture only
const UPCA = withCheck("20000000002");
const GTIN8 = withCheck("2000003");

describe("GTIN", () => {
  it("normalises GTIN-8, UPC-A, EAN-13 and GTIN-14 to GTIN-14", () => {
    expect(normalizeGtin(EAN13)).toEqual({ ok: true, gtin14: `0${EAN13}`, format: "EAN-13" });
    expect(normalizeGtin(UPCA)).toMatchObject({ gtin14: `00${UPCA}`, format: "UPC-A" });
    expect(normalizeGtin(GTIN8)).toMatchObject({ gtin14: `000000${GTIN8}`, format: "GTIN-8" });
    const g14 = withCheck("1200000000001");
    expect(normalizeGtin(g14)).toMatchObject({ gtin14: g14, format: "GTIN-14" });
  });
  it("accepts spaces and hyphens, rejects everything else with a reason", () => {
    expect(toGtin14(` ${EAN13.slice(0, 1)} ${EAN13.slice(1, 7)}-${EAN13.slice(7)} `)).toBe(
      `0${EAN13}`,
    );
    const bad = `${EAN13.slice(0, -1)}${(Number(EAN13.at(-1)) + 1) % 10}`;
    expect(normalizeGtin(bad)).toEqual({ ok: false, reason: "bad_check_digit" });
    expect(normalizeGtin("12345")).toEqual({ ok: false, reason: "bad_length" });
    expect(normalizeGtin("20000000000A")).toEqual({ ok: false, reason: "not_digits" });
    expect(normalizeGtin("0000000000000")).toEqual({ ok: false, reason: "all_zero" });
    expect(normalizeGtin("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeGtin(null)).toEqual({ ok: false, reason: "empty" });
  });
  it("displays the shortest standard form and partitions lists", () => {
    expect(displayGtin(`0${EAN13}`)).toBe(EAN13);
    expect(displayGtin(`000000${GTIN8}`)).toBe(GTIN8);
    expect(partitionGtins([EAN13, `0${EAN13}`, "123", ""])).toEqual({
      valid: [`0${EAN13}`],
      invalid: [{ raw: "123", reason: "bad_length" }],
    });
  });
});

describe("identity normalisers", () => {
  it("normalises MPNs and model keys without guessing", () => {
    expect(normalizeMpn(" mu7a3ll/a ")).toBe("MU7A3LL/A");
    expect(normalizeMpn("sm–s928b ds")).toBe("SM-S928BDS");
    expect(normalizeMpn("x")).toBeNull();
    expect(modelKey("SM-S928B")).toBe(modelKey("sm s928b"));
    expect(modelKey("Ridge™ 7800 XT")).toBe("RIDGE7800XT");
  });
  it("folds brands and strips corporate suffixes", () => {
    expect(brandKey("Corvála Electronics Co., Ltd.")).toBe("corvala");
    expect(brandKey("NOVIK Inc")).toBe("novik");
    expect(brandKey("Ltd")).toBe("ltd");
    expect(brandKey("  ")).toBeNull();
  });
  it("builds name keys for suggestions only", () => {
    expect(nameKey("Novik Aera 7 Pro (2026)", "Novik")).toBe("aera 7 pro 2026");
    expect(nameKey("Aera 7 Pro", "Novik")).toBe("aera 7 pro");
  });
  it("accepts only full ISO dates and cleans text", () => {
    expect(normalizeIsoDate("2026-03-14")).toBe("2026-03-14");
    expect(normalizeIsoDate("2026-03-14T08:00:00Z")).toBe("2026-03-14");
    expect(normalizeIsoDate("2026")).toBeNull(); // never invent a day
    expect(normalizeIsoDate("2026-02-30")).toBeNull();
    expect(normalizeText("  Aera™   7  ")).toBe("Aera 7");
    expect(plainText("<p>Fast &amp; light</p><script>x()</script><ul><li>One</li></ul>")).toBe(
      "Fast & light\nOne",
    );
  });
});

const def = (
  key: string,
  dataType: MappedDefinition["dataType"],
  canonicalUnit: string | null = null,
  validationRules: Record<string, unknown> = {},
): MappedDefinition => ({
  id: `def-${key}`,
  key,
  name: key,
  dataType,
  canonicalUnit,
  validationRules,
});

const DEFS = {
  storage: def("storage", "integer", "GB", { min: 4, max: 4096 }),
  ram: def("ram", "integer", "GB", { min: 1, max: 64 }),
  screen: def("screen_size", "decimal", "in", { min: 2, max: 12 }),
  nfc: def("nfc", "boolean"),
  codecs: def("bluetooth_codecs", "multi_select", null, { options: ["SBC", "AAC", "LDAC"] }),
  os: def("operating_system", "text", null, { maxLength: 80 }),
};

function ctx(map: Record<string, FeatureMapping>): NormalizeContext {
  return {
    mapFeature: (f) => map[f.externalId] ?? map[`name:${f.name.toLowerCase()}`] ?? null,
    variantKeys: { storage: "storage", memory: "ram" },
    confidence: 0.8,
  };
}
const feature = (
  externalId: string,
  name: string,
  value: string,
  unit: string | null = null,
): ProviderFeature => ({
  externalId,
  name,
  value,
  unit,
});
const map = (
  d: MappedDefinition,
  transform: FeatureMapping extends infer _ ? Record<string, unknown> | null : never = null,
): FeatureMapping => ({
  action: "map",
  definition: d,
  transform: transform as never,
});

describe("feature normalisation", () => {
  it("maps by provider ID or name, converts unambiguous units, keeps the raw value", () => {
    const r = normalizeFeatures(
      [
        feature("F1", "Internal storage", "1", "TB"),
        feature("F2", "RAM", "8 GB"),
        feature("F3", "Display diagonal", "15.6 cm"),
      ],
      ctx({ F1: map(DEFS.storage), "name:ram": map(DEFS.ram), F3: map(DEFS.screen) }),
    );
    expect(r.specs.map((s) => [s.key, s.columns.valueNumeric, s.rawValue, s.rawUnit])).toEqual([
      ["storage", 1000, "1", "TB"],
      ["ram", 8, "8 GB", null],
      ["screen_size", expect.closeTo(6.1417, 4), "15.6 cm", null],
    ]);
  });
  it("never assumes a unit for a bare number, unless the mapping states it", () => {
    const f = [feature("F1", "Storage", "256")];
    const without = normalizeFeatures(f, ctx({ F1: map(DEFS.storage) }));
    expect(without.specs).toHaveLength(0);
    expect(without.rejected[0]!.reason).toMatch(/no unit given/);
    const withUnit = normalizeFeatures(f, ctx({ F1: map(DEFS.storage, { unit: "GB" }) }));
    expect(withUnit.specs[0]!.columns.valueNumeric).toBe(256);
  });
  it("maps provider vocabularies, splits multi-select values and rejects out-of-range values", () => {
    const r = normalizeFeatures(
      [
        feature("F1", "NFC", "Y"),
        feature("F2", "Codecs", "SBC, AAC; LDAC"),
        feature("F3", "RAM", "512 GB"),
        feature("F4", "Unmapped thing", "42"),
        feature("F5", "Marketing blurb", "Amazing"),
        feature("F6", "RAM again", "8 GB"),
      ],
      ctx({
        F1: map(DEFS.nfc, { valueMap: { y: "yes", n: "no" } }),
        F2: map(DEFS.codecs),
        F3: map(DEFS.ram),
        F5: { action: "ignore" },
        F6: map(DEFS.ram),
      }),
    );
    expect(
      r.specs.map((s) => [
        s.key,
        s.columns.valueBoolean ?? s.columns.valueJson ?? s.columns.valueNumeric,
      ]),
    ).toEqual([
      ["nfc", true],
      ["bluetooth_codecs", ["SBC", "AAC", "LDAC"]],
      ["ram", 8],
    ]);
    expect(r.rejected.map((x) => x.key)).toEqual(["ram"]); // 512 GB is out of range
    expect(r.unmapped.map((f) => f.externalId)).toEqual(["F4"]); // ignored F5 is not reported
  });
  it("reports a second feature for the same key instead of overwriting", () => {
    const r = normalizeFeatures(
      [feature("F1", "RAM", "8 GB"), feature("F2", "Memory", "12 GB")],
      ctx({ F1: map(DEFS.ram), F2: map(DEFS.ram) }),
    );
    expect(r.specs.map((s) => s.columns.valueNumeric)).toEqual([8]);
    expect(r.rejected[0]!.reason).toMatch(/already supplied/);
  });
});

const RECORD: ProviderRecord = {
  provider: "icecat",
  providerProductId: "FIXTURE-1",
  url: "https://example.test/fixture-1",
  brand: "Novik",
  name: "Novik Aera 7 Pro",
  modelNumber: "NK-A7P",
  mpn: "nk-a7p-256-bk",
  gtins: [EAN13, "123"],
  categoryExternalId: "phones",
  categoryName: "Smartphones",
  releaseDate: "2026-03",
  description: "<b>Fixture</b> description",
  features: [feature("F1", "Storage", "256 GB"), feature("F2", "RAM", "8 GB")],
  images: [
    {
      url: "https://img.example.test/a.jpg",
      width: 800,
      height: 600,
      author: null,
      licence: null,
      licenceUrl: null,
    },
    {
      url: "http://img.example.test/b.jpg",
      width: null,
      height: null,
      author: null,
      licence: null,
      licenceUrl: null,
    },
  ],
  quality: null,
  retrievedAt: new Date("2026-11-25T10:00:00Z"),
  payloadHash: "a".repeat(64),
  variant: { colour: "Black", region: "eu", revision: null },
};

describe("normalizeRecord", () => {
  it("keeps raw values, derives variant attributes only from explicit data, reports problems", () => {
    const n = normalizeRecord(RECORD, ctx({ F1: map(DEFS.storage), F2: map(DEFS.ram) }));
    expect(n.gtins).toEqual([`0${EAN13}`]);
    expect(n.mpn).toEqual({ value: "NK-A7P-256-BK", raw: "nk-a7p-256-bk" });
    expect(n.modelNumber.key).toBe("NKA7P");
    expect(n.releaseDate).toEqual({ value: null, raw: "2026-03" });
    expect(n.description.value).toBe("Fixture description");
    expect(n.variant).toMatchObject({
      storage: "256 GB",
      memory: "8 GB",
      colour: { value: "Black", raw: "Black" },
      region: { value: "EU", raw: "eu" },
    });
    expect(n.images.map((i) => i.url)).toEqual(["https://img.example.test/a.jpg"]);
    expect(n.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/GTIN 123 rejected/),
        expect.stringMatching(/not a full date/),
        expect.stringMatching(/not https/),
      ]),
    );
  });
});

describe("variant attributes", () => {
  it("compares sizes by quantity and text by folded form; unknown is not a conflict", () => {
    expect(sameAttribute("storage", "1 TB", "1000GB")).toBe(true);
    expect(sameAttribute("colour", "Space Black", "space-black")).toBe(true);
    expect(sameAttribute("storage", "256 GB", null)).toBeNull();
    expect(
      attributeConflicts(
        { storage: "256 GB", memory: null, colour: "Black", region: null },
        { storage: "512 GB", memory: "8 GB", colour: "black", region: "EU" },
      ),
    ).toEqual(["storage"]);
  });
});

describe("field write rules", () => {
  const prov = (p: Partial<ProvenanceRow>): ProvenanceRow => ({
    field: "name",
    source_id: "src-a",
    is_manual: false,
    confidence: 0.8,
    is_current: true,
    value_hash: "x",
    ...p,
  });
  const base = { sourceId: "src-a", confidence: 0.8, productProtected: false };
  it("fills empty fields and never clears one", () => {
    expect(decideField({ ...base, current: null, incoming: "A", provenance: undefined })).toBe(
      "set",
    );
    expect(decideField({ ...base, current: "A", incoming: null, provenance: prov({}) })).toBe(
      "keep",
    );
    expect(decideField({ ...base, current: "A", incoming: "A", provenance: prov({}) })).toBe(
      "same",
    );
  });
  it("protects manual, verified and provenance-less values", () => {
    expect(
      decideField({
        ...base,
        current: "A",
        incoming: "B",
        provenance: prov({ is_manual: true, source_id: null }),
      }),
    ).toBe("conflict");
    expect(decideField({ ...base, current: "A", incoming: "B", provenance: undefined })).toBe(
      "conflict",
    );
    expect(
      decideField({
        ...base,
        current: "A",
        incoming: "B",
        provenance: prov({}),
        productProtected: true,
      }),
    ).toBe("conflict");
  });
  it("lets a source update its own value, never lowers confidence, and queues the rest", () => {
    expect(decideField({ ...base, current: "A", incoming: "B", provenance: prov({}) })).toBe("set");
    expect(
      decideField({
        ...base,
        sourceId: "src-b",
        confidence: 0.5,
        current: "A",
        incoming: "B",
        provenance: prov({ confidence: 0.9 }),
      }),
    ).toBe("lower_confidence");
    expect(
      decideField({
        ...base,
        sourceId: "src-b",
        confidence: 0.9,
        current: "A",
        incoming: "B",
        provenance: prov({ confidence: 0.5 }),
      }),
    ).toBe("conflict");
  });
});

describe("target category configuration", () => {
  it("covers the six categories with consistent, unique definitions", () => {
    expect(TARGET_CATEGORIES.map((c) => c.slug)).toEqual([
      "smartphones",
      "laptops",
      "cpus",
      "gpus",
      "monitors",
      "headphones",
    ]);
    for (const c of TARGET_CATEGORIES) {
      const keys = c.definitions.map((d) => d.key);
      expect(new Set(keys).size, c.slug).toBe(keys.length);
      for (const d of c.definitions) {
        expect(
          c.groups.some((g) => g.key === d.group),
          `${c.slug}.${d.key} group`,
        ).toBe(true);
        expect(() =>
          assertDefinitionConsistent({
            key: d.key,
            name: d.name,
            dataType: d.dataType,
            canonicalUnit: d.unit ?? null,
            validationRules: d.rules ?? {},
          }),
        ).not.toThrow();
      }
    }
    expect(variantKeysFor("smartphones")).toEqual({ memory: "ram", storage: "storage" });
    expect(variantKeysFor("gpus")).toEqual({});
  });
});
