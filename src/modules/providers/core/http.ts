import type { DbOrTx } from "@/lib/db";
import { log, redactUrl } from "@/lib/log";
import { getCachedResponse, putCachedResponse, requestKey } from "./cache";
import { reserveQuota } from "./quota";
import type { QuotaRule } from "./types";

/**
 * The one way provider adapters reach the network (DECISIONS D78):
 * - only https, only the adapter's allowed API hosts, no redirects followed (SSRF guard);
 * - a cached response is used when fresh, without touching the quota;
 * - otherwise the quota ledger reserves the call first and refuses before a limit is exceeded;
 * - requests to one provider are spaced by its minimum interval (per process);
 * - timeouts, network errors, 429 and 5xx are retried with exponential backoff and full jitter;
 *   Retry-After is honoured (up to a cap, beyond which the job is rescheduled instead);
 * - response bodies are capped; logs contain redacted URLs only, never headers or keys.
 */

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    /** Set when the provider asked to wait longer than the client will (reschedule instead). */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderHttpError";
  }
}

export class ProviderRequestRefusedError extends Error {
  constructor(provider: string, reason: string) {
    super(`${provider}: request refused (${reason})`);
    this.name = "ProviderRequestRefusedError";
  }
}

export interface HttpClientOptions {
  provider: string;
  /** For the quota ledger and the response cache; `null` disables both (unit tests only). */
  db: DbOrTx | null;
  allowedHosts: readonly string[];
  quotas: readonly QuotaRule[];
  minIntervalMs: number;
  userAgent: string;
  /** Query parameters that carry credentials (redacted in logs and cache keys). */
  secretParams?: readonly string[];
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Longest Retry-After the client waits for in-process; longer ones throw (retryAfterMs set). */
  maxRetryAfterMs?: number;
  maxBodyBytes?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
}

export interface HttpRequest {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Cache successful responses for this long; 0/undefined = no cache. */
  cacheTtlSeconds?: number;
}

export interface HttpResponse {
  status: number;
  contentType: string | null;
  body: string;
  fromCache: boolean;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULTS = {
  timeoutMs: 15_000,
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  maxRetryAfterMs: 120_000,
  maxBodyBytes: 5 * 1024 * 1024,
};

/** Per-process spacing per provider, shared by every client instance of that provider. */
const lastRequestAt = new Map<string, Promise<number>>();

/** Seconds or an HTTP date → milliseconds from now; null when absent or unparseable. */
export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now.getTime());
}

/** Full jitter: uniform in [0, min(max, base · 2^(attempt-1))]. */
export function backoffDelay(
  attempt: number,
  base: number,
  max: number,
  random: () => number,
): number {
  return Math.floor(random() * Math.min(max, base * 2 ** (attempt - 1)));
}

export class ProviderHttpClient {
  private readonly o: Required<
    Omit<HttpClientOptions, "db" | "secretParams" | "fetch" | "sleep" | "random" | "now">
  > &
    Pick<HttpClientOptions, "db"> & {
      secretParams: readonly string[];
      fetch: typeof fetch;
      sleep: (ms: number) => Promise<void>;
      random: () => number;
      now: () => Date;
    };

  constructor(options: HttpClientOptions) {
    this.o = {
      ...DEFAULTS,
      ...options,
      secretParams: options.secretParams ?? [],
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      random: options.random ?? Math.random,
      now: options.now ?? (() => new Date()),
    } as typeof this.o;
  }

  get provider() {
    return this.o.provider;
  }

  /** Returns the response for any non-retryable status (the adapter decides what 404 means). */
  async request(url: string, req: HttpRequest = {}): Promise<HttpResponse> {
    const method = req.method ?? "GET";
    this.assertAllowed(url);
    const safeUrl = redactUrl(url, this.o.secretParams);
    const key = requestKey(method, safeUrl, req.body);

    if (req.cacheTtlSeconds && this.o.db) {
      const cached = await getCachedResponse(this.o.db, this.o.provider, key, this.o.now());
      if (cached) {
        log("debug", "provider request", {
          provider: this.o.provider,
          method,
          url: safeUrl,
          status: cached.status,
          fromCache: true,
        });
        return { ...cached, fromCache: true };
      }
    }

    let lastError: ProviderHttpError | null = null;
    for (let attempt = 1; attempt <= this.o.maxAttempts; attempt++) {
      if (this.o.db)
        await reserveQuota(this.o.db, this.o.provider, this.o.quotas, { now: this.o.now() });
      await this.waitForSlot();
      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchWithTimeout(url, method, req);
      } catch (e) {
        const timedOut =
          e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
        lastError = new ProviderHttpError(
          this.o.provider,
          timedOut ? `timed out after ${this.o.timeoutMs} ms` : "network error",
          null,
          true,
        );
        log("warn", "provider request failed", {
          provider: this.o.provider,
          method,
          url: safeUrl,
          attempt,
          error: lastError.message,
        });
        if (attempt < this.o.maxAttempts)
          await this.o.sleep(
            backoffDelay(attempt, this.o.baseDelayMs, this.o.maxDelayMs, this.o.random),
          );
        continue;
      }

      const ms = Date.now() - started;
      log(res.ok ? "info" : "warn", "provider request", {
        provider: this.o.provider,
        method,
        url: safeUrl,
        status: res.status,
        ms,
        attempt,
      });

      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        throw new ProviderHttpError(
          this.o.provider,
          `unexpected redirect (${res.status})`,
          res.status,
          false,
        );
      }

      if (RETRYABLE_STATUS.has(res.status)) {
        await res.body?.cancel().catch(() => {});
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"), this.o.now());
        if (retryAfter !== null && retryAfter > this.o.maxRetryAfterMs) {
          throw new ProviderHttpError(
            this.o.provider,
            `HTTP ${res.status}; asked to retry after ${Math.round(retryAfter / 1000)} s`,
            res.status,
            true,
            retryAfter,
          );
        }
        lastError = new ProviderHttpError(this.o.provider, `HTTP ${res.status}`, res.status, true);
        if (attempt < this.o.maxAttempts)
          await this.o.sleep(
            retryAfter ??
              backoffDelay(attempt, this.o.baseDelayMs, this.o.maxDelayMs, this.o.random),
          );
        continue;
      }

      const body = await this.readCapped(res);
      const contentType = res.headers.get("content-type");
      if (res.ok && req.cacheTtlSeconds && this.o.db) {
        await putCachedResponse(this.o.db, {
          provider: this.o.provider,
          key,
          redactedUrl: safeUrl,
          status: res.status,
          contentType,
          body,
          ttlSeconds: req.cacheTtlSeconds,
          now: this.o.now(),
        });
      }
      return { status: res.status, contentType, body, fromCache: false };
    }
    throw lastError ?? new ProviderHttpError(this.o.provider, "request failed", null, true);
  }

  private assertAllowed(url: string) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new ProviderRequestRefusedError(this.o.provider, "invalid URL");
    }
    if (u.protocol !== "https:")
      throw new ProviderRequestRefusedError(this.o.provider, "not https");
    if (u.username || u.password)
      throw new ProviderRequestRefusedError(this.o.provider, "credentials in URL authority");
    if (u.port !== "") throw new ProviderRequestRefusedError(this.o.provider, "non-default port");
    if (!this.o.allowedHosts.includes(u.hostname.toLowerCase()))
      throw new ProviderRequestRefusedError(this.o.provider, `host ${u.hostname} is not allowed`);
  }

  /** Serialises request starts per provider so they are at least minIntervalMs apart. */
  private async waitForSlot() {
    if (this.o.minIntervalMs <= 0) return;
    const previous = lastRequestAt.get(this.o.provider) ?? Promise.resolve(0);
    const mine = previous.then(async (last) => {
      const wait = last + this.o.minIntervalMs - Date.now();
      if (wait > 0) await this.o.sleep(wait);
      return Date.now();
    });
    lastRequestAt.set(this.o.provider, mine);
    await mine;
  }

  private async fetchWithTimeout(url: string, method: string, req: HttpRequest) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.o.timeoutMs);
    try {
      return await this.o.fetch(url, {
        method,
        body: req.body,
        headers: { "user-agent": this.o.userAgent, accept: "application/json", ...req.headers },
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readCapped(res: Response): Promise<string> {
    const max = this.o.maxBodyBytes;
    const declared = Number(res.headers.get("content-length"));
    const tooLarge = () =>
      new ProviderHttpError(
        this.o.provider,
        `response larger than ${max} bytes`,
        res.status,
        false,
      );
    if (declared > max) {
      await res.body?.cancel().catch(() => {});
      throw tooLarge();
    }
    if (!res.body) return "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
}

/** Tests only: forget per-provider request spacing. */
export function resetRequestSpacing() {
  lastRequestAt.clear();
}
