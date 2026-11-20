import { headers } from "next/headers";
import { serializeJsonLd } from "@/modules/seo/structured-data";

/**
 * Structured data. The only `dangerouslySetInnerHTML` in the app (SPEC §13): the payload is
 * built from our own data and escaped by `serializeJsonLd` (< > & U+2028 U+2029), so it cannot
 * close the script element. Carries the CSP nonce.
 */
export async function JsonLd({ data }: { data: unknown }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const html = { __html: serializeJsonLd(data) };
  /* eslint-disable react/no-danger -- SPEC §13 allows exactly this use (safely serialized JSON-LD). */
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={html} />;
  /* eslint-enable react/no-danger */
}
