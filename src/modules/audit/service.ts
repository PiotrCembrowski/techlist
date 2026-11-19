import { auditLogs } from "@/db/schema";
import type { Tx } from "@/modules/_shared/context";

const SECRET_KEY = /pass(word)?|secret|token|hash|api[_-]?key|credential/i;

/** Deep-copies a payload with secret-looking keys removed and Dates serialised. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      if (k === "searchVector") continue;
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditEntry {
  actorId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  previous?: unknown;
  next?: unknown;
}

/** Must be called with the same transaction as the change it records. */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    adminUserId: entry.actorId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    previousData: entry.previous === undefined ? null : redact(entry.previous),
    newData: entry.next === undefined ? null : redact(entry.next),
  });
}
