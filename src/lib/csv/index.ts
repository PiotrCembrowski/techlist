/**
 * Minimal RFC 4180 CSV reading and writing (no dependency). Input must be valid UTF-8; a leading
 * BOM is ignored; fields may be quoted ("" escapes a quote) and contain commas and newlines.
 */

export class CsvError extends Error {}

/** Decodes bytes as strict UTF-8 (throws CsvError on invalid sequences). */
export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new CsvError("The file is not valid UTF-8 text");
  }
}

/** Parses CSV text into rows of fields. Stops with CsvError after `maxRows` data rows. */
export function parseCsv(text: string, opts: { maxRows?: number } = {}): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let quoted = false;
  let fieldStarted = false;
  const max = opts.maxRows === undefined ? Infinity : opts.maxRows + 1; // + header row

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    // Skip completely empty lines (common at the end of files).
    if (!(row.length === 1 && row[0] === "")) {
      rows.push(row);
      if (rows.length > max) throw new CsvError(`The file has more than ${opts.maxRows} rows`);
    }
    row = [];
  };

  while (i < s.length) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      endRow();
      i += c === "\r" && s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c;
    fieldStarted = true;
    i++;
  }
  if (quoted) throw new CsvError("A quoted field is not closed");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Turns parsed rows into header-keyed records. Duplicate or empty headers are refused. */
export function toRecords(rows: string[][]): {
  headers: string[];
  records: Record<string, string>[];
} {
  const [header, ...data] = rows;
  if (!header || header.every((h) => h.trim() === ""))
    throw new CsvError("The file has no header row");
  const headers = header.map((h) => h.trim());
  const seen = new Set<string>();
  for (const h of headers) {
    if (!h) throw new CsvError("Every column needs a header");
    if (seen.has(h.toLowerCase())) throw new CsvError(`Duplicate column "${h}"`);
    seen.add(h.toLowerCase());
  }
  const records = data.map((cells, idx) => {
    if (cells.length > headers.length) {
      throw new CsvError(
        `Row ${idx + 2} has ${cells.length} fields but the header has ${headers.length}`,
      );
    }
    return Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ""]));
  });
  return { headers, records };
}

/** Characters that make spreadsheet apps evaluate a cell as a formula (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefixes formula-like cells with `'` so spreadsheet apps show them as text. */
export function guardCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Reverses `guardCell` on import, so exported files can be re-imported unchanged. */
export function unguardCell(value: string): string {
  return value.length > 1 && value[0] === "'" && FORMULA_START.test(value.slice(1))
    ? value.slice(1)
    : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** Serializes rows (first row = header) as CSV with CRLF line endings and formula guarding. */
export function writeCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return (
    rows
      .map((r) =>
        r.map((v) => quote(guardCell(v === null || v === undefined ? "" : String(v)))).join(","),
      )
      .join("\r\n") + "\r\n"
  );
}
