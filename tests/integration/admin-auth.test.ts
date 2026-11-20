import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUsers, auditLogs, brands } from "@/db/schema";
import { closeDb } from "@/lib/db";
import { createAdminUser, setAdminActive } from "@/modules/admin-users/service";
import { ctx, db, truncateAll } from "./helpers";

// The session is whatever this mock returns; everything else (guard, DB re-check) is real.
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string } } }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => session.current),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
// revalidatePath needs a Next.js request store; it is irrelevant to authorization.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

type Action = (prev: unknown, fd: FormData) => Promise<unknown>;

const ADMIN_DIR = path.resolve("src/app/admin");
const PUBLIC_ACTION_FILES = new Set([path.join(ADMIN_DIR, "login", "actions.ts")]);

function findFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return findFiles(full, pattern);
    return pattern.test(name) ? [full] : [];
  });
}
const findActionFiles = (dir: string) =>
  findFiles(dir, /actions\.ts$/).filter((f) => !PUBLIC_ACTION_FILES.has(f));

async function loadActions(): Promise<{ name: string; fn: Action }[]> {
  const out: { name: string; fn: Action }[] = [];
  for (const file of findActionFiles(ADMIN_DIR)) {
    const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn === "function")
        out.push({ name: `${path.relative(ADMIN_DIR, file)}#${name}`, fn: fn as Action });
    }
  }
  return out;
}

/** The redirect target of a NEXT_REDIRECT error, or null for anything else. */
async function redirectOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    return digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2]! : null;
  }
}

/** A form that would succeed for an authorized user, to prove the guard (not validation) stops it. */
function brandForm(name: string) {
  const fd = new FormData();
  fd.set("name", name);
  return fd;
}

let actions: { name: string; fn: Action }[];
let editorId: string;
let ownerId: string;

beforeAll(async () => {
  await truncateAll();
  ownerId = (
    await createAdminUser(ctx(), {
      email: "owner@example.test",
      name: "Owner",
      role: "owner",
      password: "owner-password-123",
    })
  ).id;
  editorId = (
    await createAdminUser(ctx(), {
      email: "editor@example.test",
      name: "Editor",
      role: "editor",
      password: "editor-password-123",
    })
  ).id;
  actions = await loadActions();
});
beforeEach(() => {
  session.current = null;
});
afterAll(closeDb);

describe("admin Server Actions authorization", () => {
  it("discovers every admin action module", () => {
    const files = new Set(actions.map((a) => a.name.split("#")[0]!));
    for (const area of [
      "products",
      "brands",
      "categories",
      "retailers",
      "offers",
      "sources",
      "users",
    ]) {
      expect(
        [...files].some((f) => f.includes(`${area}/actions.ts`)),
        area,
      ).toBe(true);
    }
    expect(actions.length).toBeGreaterThanOrEqual(30);
  });

  it("rejects every action without a session and changes nothing", async () => {
    const auditCount = async () => (await db().select({ n: count() }).from(auditLogs))[0]!.n;
    const before = await auditCount();
    for (const a of actions) {
      expect(await redirectOf(a.fn(undefined, brandForm("Should Not Exist"))), a.name).toBe(
        "/admin/login",
      );
    }
    expect(await auditCount()).toBe(before);
    expect(
      await db().select().from(brands).where(eq(brands.name, "Should Not Exist")),
    ).toHaveLength(0);
  });

  it("rejects a session whose user no longer exists", async () => {
    session.current = { user: { id: "00000000-0000-4000-8000-000000000000" } };
    for (const a of actions)
      expect(await redirectOf(a.fn(undefined, new FormData())), a.name).toBe(
        "/admin/login?reason=inactive",
      );
  });

  it("rejects a deactivated user immediately, even with a valid session", async () => {
    const u = await createAdminUser(ctx(), {
      email: "gone@example.test",
      name: "Gone",
      password: "gone-password-123",
    });
    await setAdminActive({ db: db(), actorId: ownerId }, u.id, false);
    session.current = { user: { id: u.id } };
    for (const a of actions)
      expect(await redirectOf(a.fn(undefined, new FormData())), a.name).toBe(
        "/admin/login?reason=inactive",
      );
  });

  it("lets an active editor act, attributing the audit entry to them", async () => {
    session.current = { user: { id: editorId } };
    const create = actions.find((a) => a.name.endsWith("brands/actions.ts#createBrandAction"))!;
    // Success ends in a redirect to the new brand's page.
    expect(await redirectOf(create.fn(undefined, brandForm("Editor Brand")))).toMatch(
      /^\/admin\/brands\/[0-9a-f-]{36}\?created=1$/,
    );
    const [brand] = await db().select().from(brands).where(eq(brands.name, "Editor Brand"));
    const [entry] = await db().select().from(auditLogs).where(eq(auditLogs.entityId, brand!.id));
    expect(entry?.adminUserId).toBe(editorId);
  });

  it("returns validation errors as form state instead of throwing", async () => {
    session.current = { user: { id: editorId } };
    const update = actions.find((a) =>
      a.name.endsWith("retailers/actions.ts#createRetailerAction"),
    )!;
    const fd = new FormData();
    fd.set("name", "Bad Retailer");
    fd.set("websiteUrl", "http://insecure.example");
    fd.set("countryCode", "DE");
    fd.set("supportedCurrencies", "EUR");
    const state = (await update.fn(undefined, fd)) as {
      error?: string;
      fields?: Record<string, string>;
    };
    expect(state.error).toBeTruthy();
    expect(state.fields?.websiteUrl).toBeTruthy();
  });

  it("keeps user management owner-only", async () => {
    const owned = actions.filter((a) => a.name.includes("users/actions.ts"));
    expect(owned.length).toBeGreaterThanOrEqual(2);
    session.current = { user: { id: editorId } };
    const fd = new FormData();
    fd.set("email", "sneaky@example.test");
    fd.set("name", "Sneaky");
    fd.set("role", "owner");
    fd.set("password", "sneaky-password-123");
    fd.set("passwordConfirm", "sneaky-password-123");
    for (const a of owned)
      expect(await redirectOf(a.fn(undefined, fd)), a.name).toBe("/admin?error=forbidden");
    expect(
      await db().select().from(adminUsers).where(eq(adminUsers.email, "sneaky@example.test")),
    ).toHaveLength(0);

    session.current = { user: { id: ownerId } };
    const create = owned.find((a) => a.name.endsWith("#createUserAction"))!;
    const ok = (await create.fn(undefined, fd)) as { ok?: string };
    expect(ok.ok).toContain("sneaky@example.test");
  });

  it("rejects anonymous requests to every admin route handler (CSV downloads)", async () => {
    const files = findFiles(ADMIN_DIR, /^route\.ts$/);
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const handler = mod[method] as
          ((req: Request, ctx: unknown) => Promise<Response>) | undefined;
        if (!handler) continue;
        const req = new Request("http://localhost/admin/x?type=products&category=laptops", {
          method,
        });
        const ctxArg = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) };
        expect(
          await redirectOf(handler(req, ctxArg)),
          `${path.relative(ADMIN_DIR, file)} ${method}`,
        ).toBe("/admin/login");
      }
    }
  });

  it("does not let an owner deactivate themselves", async () => {
    session.current = { user: { id: ownerId } };
    const toggle = actions.find((a) => a.name.endsWith("#setUserActiveAction"))!;
    const fd = new FormData();
    fd.set("id", ownerId);
    const state = (await toggle.fn(undefined, fd)) as { error?: string };
    expect(state.error).toMatch(/own account/);
  });
});
