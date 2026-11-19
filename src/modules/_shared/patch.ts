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
