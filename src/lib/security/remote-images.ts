/**
 * Hosts whose images may be shown directly (hotlinked) on public pages (DECISIONS D78). An image is
 * shown only when its host is listed here AND an editor approved its rights (image_rights review).
 * The CSP's img-src is built from the same list.
 *
 * Empty until each provider's documented image host is verified. Open Icecat is not listed on
 * purpose: Icecat asks partners to host its images themselves rather than link to them (D81).
 * Wikimedia Commons: Stage 5. Exact host names only: no wildcards.
 */
export const REMOTE_IMAGE_HOSTS: readonly string[] = [];

/** https only, a listed host on the default port, and no credentials in the URL. */
export function isAllowedRemoteImage(
  url: string,
  hosts: readonly string[] = REMOTE_IMAGE_HOSTS,
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    u.port === "" &&
    u.username === "" &&
    u.password === "" &&
    hosts.includes(u.hostname.toLowerCase())
  );
}
