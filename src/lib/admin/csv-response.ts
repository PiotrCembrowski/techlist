/** A CSV download for admin route handlers (never cached, never sniffed). */
export function csvResponse(fileName: string, csv: string): Response {
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(0, 120) || "export.csv";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Slugs in query strings: lowercase letters, digits and dashes only. */
export function slugParam(value: string | null): string | null {
  return value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 120 ? value : null;
}
