import { describe, expect, it } from "vitest";
import {
  CsvError,
  decodeUtf8,
  guardCell,
  parseCsv,
  toRecords,
  unguardCell,
  writeCsv,
} from "@/lib/csv";

describe("parseCsv", () => {
  it("parses quotes, escaped quotes, commas and newlines in fields, CRLF and a BOM", () => {
    const text = '﻿a,b,c\r\n1,"two, 2","say ""hi"""\r\n"multi\nline",,x\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "two, 2", 'say "hi"'],
      ["multi\nline", "", "x"],
    ]);
  });
  it("skips blank lines and handles a missing final newline", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("rejects unclosed quotes and too many rows", () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvError);
    expect(() => parseCsv("a\n1\n2\n3", { maxRows: 2 })).toThrow(/more than 2 rows/);
    expect(parseCsv("a\n1\n2", { maxRows: 2 })).toHaveLength(3);
  });
});

describe("toRecords", () => {
  it("keys rows by trimmed header and pads short rows", () => {
    expect(toRecords([[" brand ", "name"], ["Novik"]])).toEqual({
      headers: ["brand", "name"],
      records: [{ brand: "Novik", name: "" }],
    });
  });
  it("refuses duplicate, empty headers and overlong rows", () => {
    expect(() => toRecords([["a", "A"]])).toThrow(/Duplicate/);
    expect(() => toRecords([["a", ""]])).toThrow(/header/);
    expect(() => toRecords([["a"], ["1", "2"]])).toThrow(/Row 2/);
    expect(() => toRecords([])).toThrow(/no header/);
  });
});

describe("decodeUtf8", () => {
  it("refuses invalid UTF-8", () => {
    expect(decodeUtf8(new TextEncoder().encode("Zéphyr"))).toBe("Zéphyr");
    expect(() => decodeUtf8(new Uint8Array([0x61, 0xff, 0xfe]))).toThrow(/UTF-8/);
  });
});

describe("formula injection guard", () => {
  it("prefixes cells that start with = + - @ tab or CR, and reverses it on import", () => {
    for (const v of ["=SUM(A1)", "+1", "-5", "@cmd", "\tx"]) {
      expect(guardCell(v)).toBe(`'${v}`);
      expect(unguardCell(guardCell(v))).toBe(v);
    }
    expect(guardCell("Novik")).toBe("Novik");
    expect(unguardCell("'quoted")).toBe("'quoted");
  });
  it("writes guarded, quoted CSV that parses back to the original values", () => {
    const rows = [
      ["name", "note"],
      ['=HYPERLINK("x")', 'a, "b"'],
      ["line\nbreak", " padded "],
    ];
    const csv = writeCsv(rows);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    const back = parseCsv(csv).map((r) => r.map(unguardCell));
    expect(back).toEqual(rows);
  });
});
