import { describe, expect, it } from "vitest";
import {
  gtinCheckDigit,
  isValidGtin,
  productSlugSchema,
  slugify,
  slugSchema,
} from "@/lib/validation";

describe("slugs", () => {
  it("accepts lowercase hyphenated slugs only", () => {
    expect(slugSchema.safeParse("vanta-14-2026").success).toBe(true);
    for (const bad of ["Vanta", "vanta--14", "-vanta", "vanta-", "vänta", "vanta_14", ""]) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
  it("reserves -vs- for comparison URLs", () => {
    expect(productSlugSchema.safeParse("aera-vs-pocket").success).toBe(false);
    expect(productSlugSchema.safeParse("versus-pro").success).toBe(true);
  });
  it("slugifies names", () => {
    expect(slugify("Vanta 14 (2026)")).toBe("vanta-14-2026");
    expect(slugify("Ébène  Pro—Max")).toBe("ebene-pro-max");
  });
});

describe("GTIN", () => {
  it("validates check digits", () => {
    expect(isValidGtin("4006381333931")).toBe(true); // well-known GS1 example
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("96385074")).toBe(true); // GTIN-8
    expect(isValidGtin("12345")).toBe(false);
    expect(isValidGtin("abcdefghijklm")).toBe(false);
  });
  it("computes check digits", () => {
    expect(gtinCheckDigit("400638133393")).toBe(1);
    const body = "200000000001";
    expect(isValidGtin(`${body}${gtinCheckDigit(body)}`)).toBe(true);
  });
});
