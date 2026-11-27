/**
 * Single-line JSON logs on stdout/stderr (docs/DEPLOYMENT.md). Every field passes through
 * `redact`, so credentials never reach the log even when a caller passes a URL or an object
 * that contains one.
 */

const SECRET_KEY =
  /(token|secret|password|passwd|api[-_]?key|apikey|authorization|auth(?!or)|signature|session|cookie|credential)/i;

/** Query parameters whose value is replaced by "[redacted]" in logged and cached URLs. */
export function redactUrl(url: string, extraSecretParams: readonly string[] = []): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "[invalid url]";
  }
  if (u.username || u.password) {
    u.username = "redacted";
    u.password = "";
  }
  const extra = new Set(extraSecretParams.map((p) => p.toLowerCase()));
  for (const key of [...u.searchParams.keys()]) {
    if (SECRET_KEY.test(key) || extra.has(key.toLowerCase())) u.searchParams.set(key, "[redacted]");
  }
  return u.toString();
}

/** Deep copy with secret-looking keys and URL credentials redacted. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? redactUrl(value) : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error)
    return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSink = (level: LogLevel, line: string) => void;

const defaultSink: LogSink = (level, line) => {
  if (level === "error" || level === "warn") console.error(line);
  else if (level === "info") console.log(line); // debug lines only reach a custom sink
};

let sink: LogSink = defaultSink;

/** Tests capture log lines with this; pass nothing to restore the default. */
export function setLogSink(next?: LogSink) {
  sink = next ?? defaultSink;
}

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
  const entry = { level, msg, time: new Date().toISOString(), ...(redact(fields) as object) };
  sink(level, JSON.stringify(entry));
}
