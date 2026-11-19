/**
 * Unit registry. Specification values are always stored in the definition's canonical unit;
 * this module converts user/import input ("1 TB", "15.6\"", "1,39 kg") into that unit and
 * rejects inputs whose unit belongs to a different dimension.
 *
 * Storage uses decimal SI (1 TB = 1000 GB); binary units (GiB, TiB) are accepted and converted
 * by their exact binary factor.
 */

export type Dimension =
  | "data"
  | "length"
  | "mass"
  | "frequency"
  | "power"
  | "energy"
  | "charge"
  | "time"
  | "resolution"
  | "bits"
  | "luminance"
  | "count";

interface UnitDef {
  /** Canonical symbol, as stored in specification_definitions.canonical_unit. */
  symbol: string;
  dimension: Dimension;
  /** Multiplier to the dimension's base unit. */
  factor: number;
  /** Lowercased spellings accepted on input. */
  aliases: string[];
  /** How the unit is printed after a value. */
  display: string;
}

const UNITS: UnitDef[] = [
  // data (base: byte)
  { symbol: "B", dimension: "data", factor: 1, aliases: ["b", "byte", "bytes"], display: "B" },
  { symbol: "KB", dimension: "data", factor: 1e3, aliases: ["kb"], display: "KB" },
  { symbol: "MB", dimension: "data", factor: 1e6, aliases: ["mb"], display: "MB" },
  { symbol: "GB", dimension: "data", factor: 1e9, aliases: ["gb", "gig", "gigs"], display: "GB" },
  { symbol: "TB", dimension: "data", factor: 1e12, aliases: ["tb"], display: "TB" },
  { symbol: "PB", dimension: "data", factor: 1e15, aliases: ["pb"], display: "PB" },
  { symbol: "KiB", dimension: "data", factor: 1024, aliases: ["kib"], display: "KiB" },
  { symbol: "MiB", dimension: "data", factor: 1024 ** 2, aliases: ["mib"], display: "MiB" },
  { symbol: "GiB", dimension: "data", factor: 1024 ** 3, aliases: ["gib"], display: "GiB" },
  { symbol: "TiB", dimension: "data", factor: 1024 ** 4, aliases: ["tib"], display: "TiB" },
  // length (base: metre)
  {
    symbol: "mm",
    dimension: "length",
    factor: 1e-3,
    aliases: ["mm", "millimetre", "millimeter", "millimetres", "millimeters"],
    display: "mm",
  },
  {
    symbol: "cm",
    dimension: "length",
    factor: 1e-2,
    aliases: ["cm", "centimetre", "centimeter"],
    display: "cm",
  },
  {
    symbol: "m",
    dimension: "length",
    factor: 1,
    aliases: ["m", "metre", "meter", "metres", "meters"],
    display: "m",
  },
  {
    symbol: "in",
    dimension: "length",
    factor: 0.0254,
    aliases: ["in", "inch", "inches", '"', "″", "”", "''"],
    display: "″",
  },
  // mass (base: gram)
  {
    symbol: "g",
    dimension: "mass",
    factor: 1,
    aliases: ["g", "gram", "grams", "gr"],
    display: "g",
  },
  {
    symbol: "kg",
    dimension: "mass",
    factor: 1e3,
    aliases: ["kg", "kilogram", "kilograms", "kilo", "kilos"],
    display: "kg",
  },
  {
    symbol: "lb",
    dimension: "mass",
    factor: 453.59237,
    aliases: ["lb", "lbs", "pound", "pounds"],
    display: "lb",
  },
  {
    symbol: "oz",
    dimension: "mass",
    factor: 28.349523125,
    aliases: ["oz", "ounce", "ounces"],
    display: "oz",
  },
  // frequency (base: hertz)
  { symbol: "Hz", dimension: "frequency", factor: 1, aliases: ["hz", "hertz"], display: "Hz" },
  { symbol: "kHz", dimension: "frequency", factor: 1e3, aliases: ["khz"], display: "kHz" },
  { symbol: "MHz", dimension: "frequency", factor: 1e6, aliases: ["mhz"], display: "MHz" },
  { symbol: "GHz", dimension: "frequency", factor: 1e9, aliases: ["ghz"], display: "GHz" },
  // power (base: watt)
  { symbol: "mW", dimension: "power", factor: 1e-3, aliases: ["mw"], display: "mW" },
  { symbol: "W", dimension: "power", factor: 1, aliases: ["w", "watt", "watts"], display: "W" },
  { symbol: "kW", dimension: "power", factor: 1e3, aliases: ["kw"], display: "kW" },
  // energy (base: watt-hour)
  { symbol: "mWh", dimension: "energy", factor: 1e-3, aliases: ["mwh"], display: "mWh" },
  {
    symbol: "Wh",
    dimension: "energy",
    factor: 1,
    aliases: ["wh", "watt-hour", "watt-hours"],
    display: "Wh",
  },
  { symbol: "kWh", dimension: "energy", factor: 1e3, aliases: ["kwh"], display: "kWh" },
  // electric charge (base: milliamp-hour)
  { symbol: "mAh", dimension: "charge", factor: 1, aliases: ["mah"], display: "mAh" },
  { symbol: "Ah", dimension: "charge", factor: 1e3, aliases: ["ah"], display: "Ah" },
  // time (base: second)
  {
    symbol: "ms",
    dimension: "time",
    factor: 1e-3,
    aliases: ["ms", "millisecond", "milliseconds"],
    display: "ms",
  },
  {
    symbol: "s",
    dimension: "time",
    factor: 1,
    aliases: ["s", "sec", "secs", "second", "seconds"],
    display: "s",
  },
  {
    symbol: "min",
    dimension: "time",
    factor: 60,
    aliases: ["min", "mins", "minute", "minutes"],
    display: "min",
  },
  {
    symbol: "h",
    dimension: "time",
    factor: 3600,
    aliases: ["h", "hr", "hrs", "hour", "hours"],
    display: "h",
  },
  // image resolution (base: megapixel)
  {
    symbol: "MP",
    dimension: "resolution",
    factor: 1,
    aliases: ["mp", "megapixel", "megapixels"],
    display: "MP",
  },
  // bus width (base: bit)
  { symbol: "bit", dimension: "bits", factor: 1, aliases: ["bit", "bits", "-bit"], display: "bit" },
  // luminance (base: cd/m²)
  {
    symbol: "nits",
    dimension: "luminance",
    factor: 1,
    aliases: ["nit", "nits", "cd/m2", "cd/m²", "cd/m^2"],
    display: "nits",
  },
];

const BY_SYMBOL = new Map(UNITS.map((u) => [u.symbol, u]));
const BY_ALIAS = new Map<string, UnitDef>();
for (const u of UNITS) {
  for (const a of [u.symbol.toLowerCase(), ...u.aliases]) {
    // Case-sensitive collisions (MB vs mb, mW vs MW) are resolved by registration order;
    // "mw" maps to milliwatt. Megawatts are not a hardware unit we support.
    if (!BY_ALIAS.has(a)) BY_ALIAS.set(a, u);
  }
}

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitError";
  }
}

export function isKnownUnit(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

export function getUnit(symbol: string): UnitDef | undefined {
  return BY_SYMBOL.get(symbol);
}

export function listCanonicalUnits(): string[] {
  return UNITS.map((u) => u.symbol);
}

/**
 * Parse a number written by a human. Accepts "5000", "5 000", "5,000" (thousands),
 * "1.39", "1,39" (decimal comma), "-3". Rejects anything ambiguous or non-numeric.
 */
export function parseLocaleNumber(raw: string): number {
  let s = raw.trim().replace(/[   ]/g, " ");
  if (s === "") throw new UnitError("Empty number");
  // Space-grouped thousands: "5 000" / "1 234 567,5"
  if (/^-?\d{1,3}( \d{3})+([.,]\d+)?$/.test(s)) s = s.replace(/ /g, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, ""); // 5,000 or 1,234.5
  } else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", "."); // 1.234,5
  } else if (/^-?\d+,\d+$/.test(s)) {
    s = s.replace(",", "."); // 1,39
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) throw new UnitError(`Not a number: "${raw}"`);
  const n = Number(s);
  if (!Number.isFinite(n)) throw new UnitError(`Not a number: "${raw}"`);
  return n;
}

/** Round away binary floating-point noise from unit multiplication (12 significant digits). */
function clean(n: number): number {
  return Number(n.toPrecision(12));
}

export function convert(value: number, fromSymbol: string, toSymbol: string): number {
  const from = BY_SYMBOL.get(fromSymbol);
  const to = BY_SYMBOL.get(toSymbol);
  if (!from) throw new UnitError(`Unknown unit "${fromSymbol}"`);
  if (!to) throw new UnitError(`Unknown unit "${toSymbol}"`);
  if (from.dimension !== to.dimension) {
    throw new UnitError(
      `Cannot convert ${from.symbol} (${from.dimension}) to ${to.symbol} (${to.dimension})`,
    );
  }
  return clean((value * from.factor) / to.factor);
}

const QUANTITY = /^\s*(-?[\d\s.,  ]*\d)\s*([^\d\s].*?)?\s*$/u;

/**
 * Parse "1 TB" into the canonical unit (e.g. GB -> 1000). A bare number is taken to already be
 * in the canonical unit. Throws UnitError for unknown or incompatible units.
 */
export function parseQuantity(raw: string | number, canonicalUnit: string): number {
  const canonical = BY_SYMBOL.get(canonicalUnit);
  if (!canonical) throw new UnitError(`Unknown canonical unit "${canonicalUnit}"`);
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new UnitError("Not a finite number");
    return raw;
  }
  const m = QUANTITY.exec(raw);
  if (!m) throw new UnitError(`Cannot read a quantity from "${raw}"`);
  const value = parseLocaleNumber(m[1]!);
  const unitText = m[2]?.trim();
  if (!unitText) return value;
  const unit = BY_ALIAS.get(unitText.toLowerCase()) ?? BY_ALIAS.get(unitText);
  if (!unit) throw new UnitError(`Unknown unit "${unitText}" in "${raw}"`);
  if (unit.dimension !== canonical.dimension) {
    throw new UnitError(
      `Incompatible unit "${unitText}" for ${canonical.symbol}: expected a ${canonical.dimension} unit`,
    );
  }
  return convert(value, unit.symbol, canonical.symbol);
}

/** Parse a plain number that may not carry any unit (for unitless integer/decimal specs). */
export function parseUnitless(raw: string | number): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new UnitError("Not a finite number");
    return raw;
  }
  const m = QUANTITY.exec(raw);
  if (!m || m[2]?.trim()) throw new UnitError(`Expected a plain number, got "${raw}"`);
  return parseLocaleNumber(m[1]!);
}

/** Format a canonical value with its unit for display, e.g. (14.2, "in") -> "14.2″". */
export function formatQuantity(
  value: number,
  unitSymbol: string | null | undefined,
  locale = "en-GB",
): string {
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
  if (!unitSymbol) return num;
  const unit = BY_SYMBOL.get(unitSymbol);
  const display = unit?.display ?? unitSymbol;
  return display === "″" ? `${num}″` : `${num} ${display}`;
}
