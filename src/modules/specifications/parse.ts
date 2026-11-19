import { z } from "zod";
import { isKnownUnit, parseQuantity, parseUnitless, UnitError } from "@/lib/units";
import { ValidationError } from "@/modules/_shared/errors";

export const DATA_TYPES = [
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "enum",
  "multi_select",
] as const;
export type SpecDataType = (typeof DATA_TYPES)[number];

/** validation_rules jsonb, validated before it is stored. */
export const validationRulesSchema = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().finite().optional(),
    options: z.array(z.string().trim().min(1).max(120)).min(1).max(200).optional(),
    maxLength: z.number().int().positive().max(10000).optional(),
  })
  .strict()
  .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, {
    message: "min must be <= max",
  })
  .refine(
    (r) => !r.options || new Set(r.options.map((o) => o.toLowerCase())).size === r.options.length,
    {
      message: "options must be unique (case-insensitive)",
    },
  );

export type ValidationRules = z.infer<typeof validationRulesSchema>;

export interface DefinitionShape {
  key: string;
  name: string;
  dataType: SpecDataType;
  canonicalUnit: string | null;
  validationRules: unknown;
}

/** Checks that a definition's type, unit and rules are mutually consistent. */
export function assertDefinitionConsistent(
  def: DefinitionShape & { comparisonDirection?: string },
): ValidationRules {
  const parsed = validationRulesSchema.safeParse(def.validationRules ?? {});
  if (!parsed.success)
    throw ValidationError.fromZod(parsed.error, `Invalid validation rules for "${def.key}"`);
  const rules = parsed.data;
  const numeric = def.dataType === "integer" || def.dataType === "decimal";
  if (def.canonicalUnit) {
    if (!numeric)
      throw new ValidationError(
        `"${def.key}": only integer/decimal specifications can have a unit`,
      );
    if (!isKnownUnit(def.canonicalUnit))
      throw new ValidationError(`"${def.key}": unknown unit "${def.canonicalUnit}"`);
  }
  if ((def.dataType === "enum" || def.dataType === "multi_select") && !rules.options) {
    throw new ValidationError(`"${def.key}": enum and multi_select specifications need options`);
  }
  if (rules.options && def.dataType !== "enum" && def.dataType !== "multi_select") {
    throw new ValidationError(`"${def.key}": options are only allowed for enum and multi_select`);
  }
  if (
    (rules.min !== undefined || rules.max !== undefined || rules.step !== undefined) &&
    !numeric
  ) {
    throw new ValidationError(
      `"${def.key}": min/max/step are only allowed for numeric specifications`,
    );
  }
  if (rules.maxLength !== undefined && def.dataType !== "text") {
    throw new ValidationError(`"${def.key}": maxLength is only allowed for text specifications`);
  }
  if (
    def.comparisonDirection &&
    def.comparisonDirection !== "none" &&
    !["integer", "decimal", "date", "boolean"].includes(def.dataType)
  ) {
    throw new ValidationError(
      `"${def.key}": comparison direction needs a numeric, date or boolean type`,
    );
  }
  return rules;
}

export interface SpecValueColumns {
  valueText: string | null;
  valueNumeric: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: string[] | null;
}

export type RawSpecValue = string | number | boolean | string[] | Date;

const EMPTY: SpecValueColumns = {
  valueText: null,
  valueNumeric: null,
  valueBoolean: null,
  valueDate: null,
  valueJson: null,
};

const TRUE_WORDS = new Set(["true", "yes", "y", "1"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0"]);

function fail(def: DefinitionShape, message: string): never {
  throw new ValidationError(`${def.name}: ${message}`, [{ path: def.key, message }]);
}

function matchOption(def: DefinitionShape, options: string[], raw: string): string {
  const hit = options.find((o) => o.toLowerCase() === raw.trim().toLowerCase());
  if (!hit) fail(def, `"${raw}" is not one of: ${options.join(", ")}`);
  return hit;
}

/**
 * Converts raw input into exactly one typed value column, in the definition's canonical unit.
 * Throws ValidationError on wrong types, unknown/incompatible units or rule violations.
 */
export function parseSpecificationValue(def: DefinitionShape, raw: RawSpecValue): SpecValueColumns {
  const rules = assertDefinitionConsistent(def);
  if (typeof raw === "string" && raw.trim() === "") fail(def, "value is empty");

  switch (def.dataType) {
    case "text": {
      if (typeof raw !== "string") fail(def, "expected text");
      const value = raw.trim();
      if (rules.maxLength !== undefined && value.length > rules.maxLength)
        fail(def, `must be at most ${rules.maxLength} characters`);
      return { ...EMPTY, valueText: value };
    }
    case "integer":
    case "decimal": {
      if (typeof raw !== "string" && typeof raw !== "number") fail(def, "expected a number");
      let n: number;
      try {
        n = def.canonicalUnit ? parseQuantity(raw, def.canonicalUnit) : parseUnitless(raw);
      } catch (e) {
        if (e instanceof UnitError) fail(def, e.message);
        throw e;
      }
      if (def.dataType === "integer" && !Number.isInteger(n))
        fail(
          def,
          `must be a whole number${def.canonicalUnit ? ` of ${def.canonicalUnit}` : ""} (got ${n})`,
        );
      if (rules.min !== undefined && n < rules.min) fail(def, `must be at least ${rules.min}`);
      if (rules.max !== undefined && n > rules.max) fail(def, `must be at most ${rules.max}`);
      if (rules.step !== undefined) {
        const ratio = n / rules.step;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-9)
          fail(def, `must be a multiple of ${rules.step}`);
      }
      return { ...EMPTY, valueNumeric: n };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ...EMPTY, valueBoolean: raw };
      if (typeof raw !== "string" && typeof raw !== "number") fail(def, "expected yes/no");
      const word = String(raw).trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return { ...EMPTY, valueBoolean: true };
      if (FALSE_WORDS.has(word)) return { ...EMPTY, valueBoolean: false };
      fail(def, `"${raw}" is not yes/no`);
    }
    // falls through is impossible: fail() never returns
    case "date": {
      const iso =
        raw instanceof Date
          ? raw.toISOString().slice(0, 10)
          : typeof raw === "string"
            ? raw.trim()
            : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) fail(def, "expected a date as YYYY-MM-DD");
      const d = new Date(`${iso}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso)
        fail(def, `"${iso}" is not a real date`);
      return { ...EMPTY, valueDate: iso };
    }
    case "enum": {
      if (typeof raw !== "string") fail(def, "expected one option");
      return { ...EMPTY, valueText: matchOption(def, rules.options!, raw) };
    }
    case "multi_select": {
      const parts = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
          ? raw.split(/[;,|]/)
          : fail(def, "expected a list of options");
      const values = parts.map((p) => p.trim()).filter(Boolean);
      if (values.length === 0) fail(def, "select at least one option");
      const matched = [...new Set(values.map((v) => matchOption(def, rules.options!, v)))];
      // Keep the definition's option order so equal sets compare equal.
      matched.sort((a, b) => rules.options!.indexOf(a) - rules.options!.indexOf(b));
      return { ...EMPTY, valueJson: matched };
    }
  }
}

export function sameValue(a: SpecValueColumns, b: SpecValueColumns): boolean {
  return (
    a.valueText === b.valueText &&
    (a.valueNumeric === null || b.valueNumeric === null
      ? a.valueNumeric === b.valueNumeric
      : Number(a.valueNumeric) === Number(b.valueNumeric)) &&
    a.valueBoolean === b.valueBoolean &&
    a.valueDate === b.valueDate &&
    JSON.stringify(a.valueJson) === JSON.stringify(b.valueJson)
  );
}
