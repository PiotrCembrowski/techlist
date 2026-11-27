import { REMOTE_IMAGE_HOSTS } from "./remote-images";

/**
 * SPEC §13 Content Security Policy. Scripts need the per-request nonce (Next.js adds it to its
 * own scripts; `strict-dynamic` lets those load the rest). Inline style attributes are allowed:
 * they cannot run code, and several components set widths/offsets inline.
 */
export function contentSecurityPolicy(
  nonce: string,
  opts: { dev: boolean; https: boolean; imageHosts?: readonly string[] },
): string {
  const imageHosts = (opts.imageHosts ?? REMOTE_IMAGE_HOSTS).map((h) => ` https://${h}`).join("");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${imageHosts}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}
