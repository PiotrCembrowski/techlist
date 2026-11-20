/** Normalise for matching: strip accents, lowercase. */
export function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Alphanumeric tokens of a query ("Aera 7-Pro!" -> ["aera", "7", "pro"]). At most 8 tokens. */
export function tokenize(q: string): string[] {
  return fold(q)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * A to_tsquery() string with prefix matching on every token ("aera:* & 7:*"). Built only from
 * [a-z0-9] tokens, so user input can never inject tsquery operators. Returns null for no tokens.
 */
export function buildPrefixTsQuery(q: string): string | null {
  const tokens = tokenize(q);
  return tokens.length ? tokens.map((t) => `${t}:*`).join(" & ") : null;
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into parts, marking every occurrence of a query token (accent- and
 * case-insensitive). Positions map 1:1 because folding is done per character.
 */
export function highlight(text: string, q: string): HighlightPart[] {
  const tokens = tokenize(q).filter((t) => t.length >= 1);
  if (!text || tokens.length === 0) return [{ text, match: false }];
  const chars = [...text];
  const folded = chars.map((c) => fold(c) || c);
  const marks = new Array<boolean>(chars.length).fill(false);
  const haystack = folded.join("");
  // Map from folded-string offset to char index (a folded char may expand, e.g. "ß" -> "ss").
  const offsetToChar: number[] = [];
  folded.forEach((f, i) => {
    for (let k = 0; k < f.length; k++) offsetToChar.push(i);
  });
  for (const t of [...tokens].sort((a, b) => b.length - a.length)) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(t, from);
      if (at === -1) break;
      for (let k = at; k < at + t.length; k++) marks[offsetToChar[k]!] = true;
      from = at + t.length;
    }
  }
  const parts: HighlightPart[] = [];
  chars.forEach((c, i) => {
    const last = parts[parts.length - 1];
    if (last && last.match === marks[i]) last.text += c;
    else parts.push({ text: c, match: marks[i]! });
  });
  return parts;
}
