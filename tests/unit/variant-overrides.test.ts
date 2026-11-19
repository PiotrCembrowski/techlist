import { describe, expect, it } from "vitest";
import {
  resolveVariantOverrides,
  type EffectiveDefinition,
  type ProductSpecification,
} from "@/modules/specifications/service";

const def = (id: string) => ({ id, key: id }) as unknown as EffectiveDefinition;
const row = (definition: string, variantId: string | null, n: number) =>
  ({
    specificationDefinitionId: definition,
    variantId,
    valueNumeric: n,
  }) as unknown as ProductSpecification;

describe("resolveVariantOverrides", () => {
  const defs = [def("storage"), def("ram"), def("weight")];
  const rows = [
    row("storage", null, 256),
    row("storage", "v512", 512),
    row("storage", "v1tb", 1000),
    row("ram", null, 12),
  ];

  it("uses product-level values when no variant is selected", () => {
    const out = resolveVariantOverrides(defs, rows, null);
    expect(out.map((r) => [r.definition.id, r.value.valueNumeric, r.isVariantOverride])).toEqual([
      ["storage", 256, false],
      ["ram", 12, false],
    ]);
  });
  it("lets the selected variant override, and ignores other variants", () => {
    const out = resolveVariantOverrides(defs, rows, "v1tb");
    expect(out.find((r) => r.definition.id === "storage")?.value.valueNumeric).toBe(1000);
    expect(out.find((r) => r.definition.id === "storage")?.isVariantOverride).toBe(true);
    expect(out.find((r) => r.definition.id === "ram")?.value.valueNumeric).toBe(12);
  });
  it("omits definitions with no value (UI shows 'Not available')", () => {
    expect(
      resolveVariantOverrides(defs, rows, null).some((r) => r.definition.id === "weight"),
    ).toBe(false);
  });
});
