import { describe, expect, it } from "vitest";
import { clientAddress } from "@/lib/rate-limit";
import { contentSecurityPolicy, newNonce } from "@/lib/security/csp";

describe("clientAddress", () => {
  const h = (xff?: string, real?: string) => {
    const headers = new Headers();
    if (xff !== undefined) headers.set("x-forwarded-for", xff);
    if (real !== undefined) headers.set("x-real-ip", real);
    return headers;
  };
  it("takes the address the trusted proxy appended, not what the client claims", () => {
    // The client sent "1.1.1.1"; our single proxy appended the real peer, 203.0.113.9.
    expect(clientAddress(h("1.1.1.1, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientAddress(h("1.1.1.1, 198.51.100.2, 203.0.113.9"), 2)).toBe("198.51.100.2");
    expect(clientAddress(h("203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientAddress(h("203.0.113.9"), 3)).toBe("203.0.113.9");
  });
  it("falls back to x-real-ip, then one shared bucket; hops = 0 ignores the headers", () => {
    expect(clientAddress(h(undefined, "203.0.113.5"), 1)).toBe("203.0.113.5");
    expect(clientAddress(h(), 1)).toBe("unknown");
    expect(clientAddress(h("203.0.113.9"), 0)).toBe("unknown");
  });
});

describe("content security policy", () => {
  it("allows only nonce'd scripts and forbids framing, plugins and foreign forms", () => {
    const csp = contentSecurityPolicy("abc", { dev: false, https: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("abc", { dev: true, https: false })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy("abc", { dev: false, https: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
  it("creates unpredictable nonces", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});
