/**
 * Keep only keys the caller actually provided. Zod defaults inside `.partial()` schemas would
 * otherwise turn an omitted field into its default and silently overwrite stored data.
 */
export function onlyProvided<T extends Record<string, unknown>>(
  parsed: T,
  input: object,
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(input)) {
    if (key in parsed && (input as Record<string, unknown>)[key] !== undefined) {
      (out as Record<string, unknown>)[key] = parsed[key];
    }
  }
  return out;
}

/** The entries of `patch` whose value differs from `before` (dates and arrays compared by value). */
export function changedFields(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const norm = (v: unknown) => JSON.stringify(v instanceof Date ? v.toISOString() : (v ?? null));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (norm(before[k]) !== norm(v)) out[k] = v;
  return out;
}
