import { eq, sql } from "drizzle-orm";
import { providerSettings } from "@/db/schema";
import type { Env } from "@/config/env";
import type { DbOrTx } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import { ValidationError } from "@/modules/_shared/errors";
import { getAdapter } from "./registry";
import type { ProviderAdapter, ProviderHealth, ProviderKey } from "./types";
import { PROVIDER_KEYS } from "./types";

export type ProviderSettings = typeof providerSettings.$inferSelect;

export function isProviderKey(value: unknown): value is ProviderKey {
  return typeof value === "string" && (PROVIDER_KEYS as readonly string[]).includes(value);
}

/** Settings row for a provider; providers without a row are disabled. */
export async function getProviderSettings(
  db: DbOrTx,
  provider: ProviderKey,
): Promise<ProviderSettings | null> {
  const [row] = await db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.provider, provider));
  return row ?? null;
}

/**
 * Turns a provider on or off (admin switch, audited). Turning one on requires its env
 * configuration; the switch never stores credentials.
 */
export async function setProviderEnabled(
  ctx: ServiceContext,
  provider: ProviderKey,
  enabled: boolean,
  env: Env,
): Promise<ProviderSettings> {
  const adapter = getAdapter(provider);
  if (enabled) {
    if (!adapter) throw new ValidationError(`${provider} has no adapter yet and cannot be enabled`);
    const missing = adapter.missingConfig(env);
    if (missing.length)
      throw new ValidationError(
        `${adapter.displayName} is not configured: set ${missing.join(", ")}`,
      );
  }
  return inTransaction(ctx, async (tx) => {
    const before = await getProviderSettings(tx, provider);
    const [row] = await tx
      .insert(providerSettings)
      .values({ provider, enabled, updatedBy: ctx.actorId })
      .onConflictDoUpdate({
        target: providerSettings.provider,
        set: { enabled, updatedBy: ctx.actorId },
      })
      .returning();
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entityType: "provider_settings",
      entityId: null,
      action: enabled ? `enable:${provider}` : `disable:${provider}`,
      previous: before,
      next: row,
    });
    return row!;
  });
}

export async function recordProviderHealth(
  db: DbOrTx,
  provider: ProviderKey,
  health: ProviderHealth,
): Promise<void> {
  const message = health.message?.slice(0, 500) ?? null;
  await db.execute(sql`
    INSERT INTO provider_settings (provider, last_health_status, last_health_checked_at, last_health_message)
    VALUES (${provider}, ${health.status}, ${health.checkedAt.toISOString()}::timestamptz, ${message})
    ON CONFLICT (provider) DO UPDATE SET
      last_health_status = EXCLUDED.last_health_status,
      last_health_checked_at = EXCLUDED.last_health_checked_at,
      last_health_message = EXCLUDED.last_health_message`);
}

export type ProviderAvailability =
  | { runnable: true; adapter: ProviderAdapter }
  | { runnable: false; reason: "no_adapter" | "not_configured" | "disabled"; missing?: string[] };

/** A provider may be called only when it has an adapter, is configured in env and is enabled. */
export async function providerAvailability(
  db: DbOrTx,
  provider: ProviderKey,
  env: Env,
): Promise<ProviderAvailability> {
  const adapter = getAdapter(provider);
  if (!adapter) return { runnable: false, reason: "no_adapter" };
  const missing = adapter.missingConfig(env);
  if (missing.length) return { runnable: false, reason: "not_configured", missing };
  const settings = await getProviderSettings(db, provider);
  if (!settings?.enabled) return { runnable: false, reason: "disabled" };
  return { runnable: true, adapter };
}
