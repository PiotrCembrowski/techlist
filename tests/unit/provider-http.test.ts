import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { log, redact, redactUrl, setLogSink } from "@/lib/log";
import {
  backoffDelay,
  parseRetryAfter,
  ProviderHttpClient,
  ProviderHttpError,
  ProviderRequestRefusedError,
  resetRequestSpacing,
  type HttpClientOptions,
} from "@/modules/providers/core/http";

// Ordinary tests must never reach the network: any real fetch fails the test.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("Real network call attempted in a unit test");
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

type Reply = Response | Error | "hang";

/** A fake fetch that answers from a script and records every call. */
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = replies.shift() ?? new Response("{}", { status: 200 });
    if (next === "hang")
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        ),
      );
    if (next instanceof Error) throw next;
    return next;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function client(replies: Reply[], extra: Partial<HttpClientOptions> = {}) {
  const f = fakeFetch(replies);
  const sleeps: number[] = [];
  const c = new ProviderHttpClient({
    provider: "testprov",
    db: null,
    allowedHosts: ["api.example.test"],
    quotas: [],
    minIntervalMs: 0,
    userAgent: "Specbase-test/1.0 (+https://example.test)",
    secretParams: ["user"],
    timeoutMs: 30,
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    maxRetryAfterMs: 5000,
    maxBodyBytes: 1000,
    fetch: f.fn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...extra,
  });
  return { c, calls: f.calls, sleeps };
}

const URL_OK = "https://api.example.test/v1/products?gtin=04006381333931";

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  setLogSink((_, line) => lines.push(line));
  resetRequestSpacing();
});
afterEach(() => setLogSink());

describe("provider HTTP client", () => {
  it("refuses other hosts, plain http, ports and URL credentials before any request", async () => {
    const { c, calls } = client([]);
    for (const url of [
      "https://evil.example.test/x",
      "http://api.example.test/x",
      "https://api.example.test:8443/x",
      "https://u:p@api.example.test/x",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
    ]) {
      await expect(c.request(url), url).rejects.toBeInstanceOf(ProviderRequestRefusedError);
    }
    expect(calls).toHaveLength(0);
  });

  it("sends its User-Agent, never follows redirects, and returns the body", async () => {
    const { c, calls } = client([json({ ok: true })]);
    const res = await c.request(URL_OK);
    expect(res).toMatchObject({ status: 200, fromCache: false, body: '{"ok":true}' });
    expect(calls[0]!.init.redirect).toBe("manual");
    expect((calls[0]!.init.headers as Record<string, string>)["user-agent"]).toMatch(/^Specbase/);
  });

  it("retries 5xx with exponential backoff and full jitter, then succeeds", async () => {
    const { c, calls, sleeps } = client([json({}, 503), json({}, 502), json({ ok: 1 })]);
    expect((await c.request(URL_OK)).status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([50, 100]); // 0.5 × 100, 0.5 × 200
  });

  it("honours Retry-After (seconds and HTTP date) on 429", async () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const { c, sleeps } = client(
      [
        json({}, 429, { "retry-after": "2" }),
        json({}, 429, { "retry-after": new Date(now.getTime() + 3000).toUTCString() }),
        json({}),
      ],
      { now: () => now },
    );
    await c.request(URL_OK);
    expect(sleeps).toEqual([2000, 3000]);
  });

  it("does not wait for a Retry-After beyond the cap: it throws so the job is rescheduled", async () => {
    const { c, calls, sleeps } = client([json({}, 429, { "retry-after": "3600" })]);
    const err = await c.request(URL_OK).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err).toMatchObject({ status: 429, retryable: true, retryAfterMs: 3_600_000 });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("gives up after the last attempt with a retryable error", async () => {
    const { c, calls } = client([json({}, 500), json({}, 500), json({}, 500)]);
    await expect(c.request(URL_OK)).rejects.toMatchObject({ status: 500, retryable: true });
    expect(calls).toHaveLength(3);
  });

  it("returns 4xx other than 429 without retrying (the adapter decides what 404 means)", async () => {
    const { c, calls } = client([json({ error: "not found" }, 404)]);
    expect((await c.request(URL_OK)).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("treats a redirect as an error", async () => {
    const { c } = client([
      new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } }),
    ]);
    await expect(c.request(URL_OK)).rejects.toMatchObject({ status: 302, retryable: false });
  });

  it("times out hanging requests and retries them", async () => {
    const { c, calls } = client(["hang", "hang", "hang"]);
    await expect(c.request(URL_OK)).rejects.toThrow(/timed out after 30 ms/);
    expect(calls).toHaveLength(3);
  });

  it("retries network errors", async () => {
    const { c } = client([new TypeError("fetch failed"), json({ ok: 1 })]);
    expect((await c.request(URL_OK)).status).toBe(200);
  });

  it("caps response bodies (declared and streamed)", async () => {
    const big = "x".repeat(2000);
    const { c: declared } = client([new Response(big, { headers: { "content-length": "2000" } })]);
    await expect(declared.request(URL_OK)).rejects.toThrow(/larger than 1000 bytes/);
    const stream = new ReadableStream({
      start(ctrl) {
        for (let i = 0; i < 5; i++) ctrl.enqueue(new TextEncoder().encode("y".repeat(300)));
        ctrl.close();
      },
    });
    const { c: streamed } = client([new Response(stream)]);
    await expect(streamed.request(URL_OK)).rejects.toMatchObject({ retryable: false });
  });

  it("spaces requests to one provider by its minimum interval", async () => {
    const { c, sleeps } = client([json({}), json({})], { minIntervalMs: 60_000 });
    await c.request(URL_OK);
    await c.request(URL_OK);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(59_000);
  });

  it("logs redacted URLs only: no credentials, no headers", async () => {
    const { c } = client([json({})]);
    await c.request(
      "https://api.example.test/v1/p?user=alice&api_token=SECRET123&content_token=SECRET456&lang=en",
      { headers: { authorization: "Bearer SECRET789" } },
    );
    const all = lines.join("\n");
    expect(all).toContain("provider request");
    expect(all).not.toMatch(/SECRET|alice|Bearer/);
    expect(all).toContain("lang=en");
  });
});

describe("retry helpers", () => {
  it("parses Retry-After", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(parseRetryAfter("5", now)).toBe(5000);
    expect(parseRetryAfter("Wed, 25 Nov 2026 12:00:10 GMT", now)).toBe(10_000);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
  it("caps the backoff ceiling", () => {
    expect(backoffDelay(1, 500, 30_000, () => 1)).toBe(500);
    expect(backoffDelay(4, 500, 30_000, () => 1)).toBe(4000);
    expect(backoffDelay(20, 500, 30_000, () => 1)).toBe(30_000);
    expect(backoffDelay(3, 500, 30_000, () => 0)).toBe(0);
  });
});

describe("log redaction", () => {
  it("redacts credential query parameters and URL user info", () => {
    expect(redactUrl("https://u:pw@h.test/a?api_token=1&x=2&user=bob", ["user"])).toBe(
      "https://redacted@h.test/a?api_token=%5Bredacted%5D&x=2&user=%5Bredacted%5D",
    );
    expect(redactUrl("::")).toBe("[invalid url]");
  });
  it("redacts secret-looking keys and URLs at any depth", () => {
    expect(
      redact({
        clientSecret: "s",
        nested: { Authorization: "Bearer t", url: "https://h.test/?token=abc", n: 1 },
      }),
    ).toEqual({
      clientSecret: "[redacted]",
      nested: {
        Authorization: "[redacted]",
        url: "https://h.test/?token=%5Bredacted%5D",
        n: 1,
      },
    });
  });
  it("writes one JSON line per entry", () => {
    log("info", "hello", { apiKey: "k" });
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: "info",
      msg: "hello",
      apiKey: "[redacted]",
    });
  });
});

describe("log redaction keeps harmless keys", () => {
  it("does not redact `author`", () => {
    expect(redact({ author: "Jane", auth: "x" })).toEqual({ author: "Jane", auth: "[redacted]" });
  });
});
