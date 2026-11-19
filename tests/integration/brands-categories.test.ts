import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, brands, slugRedirects } from "@/db/schema";
import { closeDb } from "@/lib/db";
import { createBrand, findBrandByNameOrAlias, updateBrand } from "@/modules/brands/service";
import { createCategory, getCategoryAncestors, updateCategory } from "@/modules/categories/service";
import { ConflictError, ValidationError } from "@/modules/_shared/errors";
import { createSpecificationDefinition } from "@/modules/specifications/service";
import { ctx, db, truncateAll } from "./helpers";

beforeEach(truncateAll);
afterAll(closeDb);

describe("brands", () => {
  it("creates a brand with a derived slug and writes an audit entry", async () => {
    const b = await createBrand(ctx(), {
      name: "Halden Systems",
      aliases: ["HS", "hs"],
      officialWebsiteUrl: "https://halden.example",
    });
    expect(b.slug).toBe("halden-systems");
    expect(b.aliases).toEqual(["hs"]); // case-insensitive dedupe, last spelling wins
    const audits = await db().select().from(auditLogs).where(eq(auditLogs.entityId, b.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: "brand", action: "create", adminUserId: null });
  });

  it("blocks duplicates that differ only by case or accents", async () => {
    await createBrand(ctx(), { name: "Corvala" });
    await expect(createBrand(ctx(), { name: "CORVALA", slug: "corvala-2" })).rejects.toThrow(
      ConflictError,
    );
    await createBrand(ctx(), { name: "Ostrå" });
    await expect(createBrand(ctx(), { name: "ostra", slug: "ostra-2" })).rejects.toThrow(
      /case and accents/,
    );
  });

  it("rejects invalid input via Zod", async () => {
    await expect(
      createBrand(ctx(), { name: "X", officialWebsiteUrl: "http://insecure.example" }),
    ).rejects.toThrow(ValidationError);
    await expect(createBrand(ctx(), { name: "X", countryOfOrigin: "pol" })).rejects.toThrow(
      ValidationError,
    );
    await expect(createBrand(ctx(), { name: "X", slug: "Bad Slug" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("finds brands by name or alias, ignoring case and accents", async () => {
    const b = await createBrand(ctx(), { name: "Novik", aliases: ["Növik Mobile"] });
    expect((await findBrandByNameOrAlias(db(), "NOVIK"))?.id).toBe(b.id);
    expect((await findBrandByNameOrAlias(db(), "novik mobile"))?.id).toBe(b.id);
    expect(await findBrandByNameOrAlias(db(), "Nobody")).toBeNull();
  });

  it("updates only provided fields and records slug redirects without chains", async () => {
    const b = await createBrand(ctx(), { name: "Quill", aliases: ["Q"], isActive: true });
    await updateBrand(ctx(), b.id, { isActive: false });
    const [after] = await db().select().from(brands).where(eq(brands.id, b.id));
    expect(after).toMatchObject({ isActive: false, aliases: ["Q"], name: "Quill" }); // defaults did not overwrite

    await updateBrand(ctx(), b.id, { slug: "quillon" });
    await updateBrand(ctx(), b.id, { slug: "quillon-av" });
    const redirects = await db().select().from(slugRedirects).orderBy(slugRedirects.oldSlug);
    expect(redirects.map((r) => [r.oldSlug, r.newSlug])).toEqual([
      ["quill", "quillon-av"],
      ["quillon", "quillon-av"],
    ]);
    // Reverting to an old slug removes its redirect (the slug is live again).
    await updateBrand(ctx(), b.id, { slug: "quill" });
    const after2 = await db().select().from(slugRedirects).orderBy(slugRedirects.oldSlug);
    expect(after2.map((r) => [r.oldSlug, r.newSlug])).toEqual([
      ["quillon", "quill"],
      ["quillon-av", "quill"],
    ]);
  });

  it("rolls back the audit entry when the write fails (same transaction)", async () => {
    await createBrand(ctx(), { name: "Taken" });
    const before = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs);
    await expect(createBrand(ctx(), { name: "taken", slug: "other" })).rejects.toThrow(
      ConflictError,
    );
    const after = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs);
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

describe("categories", () => {
  it("resolves ancestors root-first in one recursive query", async () => {
    const root = await createCategory(ctx(), { name: "Laptops" });
    const mid = await createCategory(ctx(), { name: "Gaming laptops", parentId: root.id });
    const leaf = await createCategory(ctx(), { name: "Thin gaming laptops", parentId: mid.id });
    const chain = await getCategoryAncestors(db(), leaf.id);
    expect(chain.map((c) => c.slug)).toEqual(["laptops", "gaming-laptops", "thin-gaming-laptops"]);
  });

  it("prevents cycles", async () => {
    const a = await createCategory(ctx(), { name: "A" });
    const b = await createCategory(ctx(), { name: "B", parentId: a.id });
    const c = await createCategory(ctx(), { name: "C", parentId: b.id });
    await expect(updateCategory(ctx(), a.id, { parentId: c.id })).rejects.toThrow(/cycle/);
    await expect(updateCategory(ctx(), a.id, { parentId: a.id })).rejects.toThrow(/own parent/);
  });

  it("refuses a re-parent that would duplicate a spec key in the chain", async () => {
    const phones = await createCategory(ctx(), { name: "Phones" });
    const tablets = await createCategory(ctx(), { name: "Tablets" });
    await createSpecificationDefinition(ctx(), {
      categoryId: phones.id,
      key: "ram",
      name: "RAM",
      dataType: "integer",
      canonicalUnit: "GB",
    });
    await createSpecificationDefinition(ctx(), {
      categoryId: tablets.id,
      key: "ram",
      name: "RAM",
      dataType: "integer",
      canonicalUnit: "GB",
    });
    await expect(updateCategory(ctx(), tablets.id, { parentId: phones.id })).rejects.toThrow(
      /clash.*ram/,
    );
  });

  it("rejects an unknown parent", async () => {
    await expect(
      createCategory(ctx(), { name: "Orphan", parentId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow(/not found/);
  });
});
