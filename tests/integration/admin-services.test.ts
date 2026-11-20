import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminUsers, productImages, productRelationships } from "@/db/schema";
import { checkCredentials, LOGIN_LIMIT } from "@/lib/auth/credentials";
import { closeDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { createAdminUser, verifyAdminCredentials } from "@/modules/admin-users/service";
import {
  addRelationship,
  addSourceRecord,
  deleteProductImage,
  findSimilarBrands,
  setPrimaryImage,
  updateSpecificationDefinition,
  uploadProductImage,
} from "@/modules/catalog-admin/service";
import { getPrimaryImages, getProductGallery } from "@/modules/media/public";
import { createRetailer, updateRetailer } from "@/modules/retailers/service";
import { createSource } from "@/modules/sources/service";
import { setSpecificationValue } from "@/modules/specifications/service";
import { ctx, db, makeBrand, makeProduct, makeSpecCategory, truncateAll } from "./helpers";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
]);
const png = (name = "x.png") => new File([PNG], name, { type: "image/png" });
const UPLOAD_DIR = path.resolve("storage/test-uploads");

beforeAll(async () => {
  await truncateAll();
  await rm(UPLOAD_DIR, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(UPLOAD_DIR, { recursive: true, force: true });
  await closeDb();
});

describe("admin users and login", () => {
  it("hashes passwords, enforces the policy and never returns the hash", async () => {
    await expect(
      createAdminUser(ctx(), { email: "a@example.test", name: "A", password: "short" }),
    ).rejects.toThrow(/Invalid admin user/);
    await expect(
      createAdminUser(ctx(), { email: "a@example.test", name: "A", password: "aaaaaaaaaaaaaa" }),
    ).rejects.toThrow();
    const u = await createAdminUser(ctx(), {
      email: "A@Example.test",
      name: "A",
      password: "a-long-enough-password",
    });
    expect(u.email).toBe("a@example.test");
    expect(u).not.toHaveProperty("passwordHash");
    const [row] = await db().select().from(adminUsers).where(eq(adminUsers.id, u.id));
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      createAdminUser(ctx(), {
        email: "a@example.test",
        name: "Dup",
        password: "another-long-password",
      }),
    ).rejects.toThrow(/already exists|duplicate|conflict/i);
  });

  it("verifies credentials, rejects wrong passwords and inactive accounts", async () => {
    expect(
      await verifyAdminCredentials(db(), "a@example.test", "a-long-enough-password"),
    ).toMatchObject({ email: "a@example.test" });
    expect(await verifyAdminCredentials(db(), "a@example.test", "wrong-password-here")).toBeNull();
    expect(
      await verifyAdminCredentials(db(), "nobody@example.test", "a-long-enough-password"),
    ).toBeNull();
    await db()
      .update(adminUsers)
      .set({ isActive: false })
      .where(eq(adminUsers.email, "a@example.test"));
    expect(
      await verifyAdminCredentials(db(), "a@example.test", "a-long-enough-password"),
    ).toBeNull();
    await db()
      .update(adminUsers)
      .set({ isActive: true })
      .where(eq(adminUsers.email, "a@example.test"));
  });

  it("rate-limits login attempts per IP and email, even with the right password", async () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
    // Inside the current 15-minute window: the limiter prunes rows older than a day at random.
    const base = Math.floor(Date.now() / 900_000) * 900_000 + 1_000;
    const now = () => new Date(base);
    for (let i = 0; i < LOGIN_LIMIT; i++) {
      expect(
        (
          await checkCredentials(
            db(),
            { email: "a@example.test", password: "wrong-password-here" },
            headers,
            now,
          )
        ).kind,
      ).toBe("invalid");
    }
    expect(
      (
        await checkCredentials(
          db(),
          { email: "a@example.test", password: "a-long-enough-password" },
          headers,
          now,
        )
      ).kind,
    ).toBe("rate_limited");
    // Another address is not affected; a new window starts after 15 minutes.
    const other = new Headers({ "x-forwarded-for": "203.0.113.8" });
    expect(
      (
        await checkCredentials(
          db(),
          { email: "a@example.test", password: "a-long-enough-password" },
          other,
          now,
        )
      ).kind,
    ).toBe("ok");
    const later = () => new Date(base + 16 * 60_000);
    expect(
      (
        await checkCredentials(
          db(),
          { email: "a@example.test", password: "a-long-enough-password" },
          headers,
          later,
        )
      ).kind,
    ).toBe("ok");
  });

  it("rejects malformed credentials without touching the limiter", async () => {
    expect(
      (
        await checkCredentials(
          db(),
          { email: "not-an-email", password: "x" },
          new Headers(),
          () => new Date(),
        )
      ).kind,
    ).toBe("invalid");
  });
});

describe("catalogue admin services", () => {
  it("stores predecessor as reversed succession and refuses the opposite direction", async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    const row = await addRelationship(ctx(), {
      productId: b.id,
      otherProductId: a.id,
      kind: "predecessor",
    });
    expect(row).toMatchObject({
      sourceProductId: a.id,
      targetProductId: b.id,
      relationshipType: "successor",
    });
    await expect(
      addRelationship(ctx(), { productId: b.id, otherProductId: a.id, kind: "successor" }),
    ).rejects.toThrow(/opposite succession/);
    await expect(
      addRelationship(ctx(), { productId: a.id, otherProductId: a.id, kind: "related" }),
    ).rejects.toThrow(/itself/);
    expect(await db().select().from(productRelationships)).toHaveLength(1);
  });

  it("refuses provenance from sources whose usage is not permitted", async () => {
    const p = await makeProduct();
    const blocked = await createSource(ctx(), {
      sourceName: "Unlicensed feed",
      sourceType: "licensed_provider",
      usagePermitted: false,
    });
    const ok = await createSource(ctx(), {
      sourceName: "Press kit",
      sourceType: "manufacturer",
      usagePermitted: true,
    });
    await expect(addSourceRecord(ctx(), { productId: p.id, sourceId: blocked.id })).rejects.toThrow(
      /does not permit/,
    );
    expect(await addSourceRecord(ctx(), { productId: p.id, sourceId: ok.id })).toMatchObject({
      sourceId: ok.id,
    });
  });

  it("uploads images to storage, keeps exactly one primary and hides unlicensed ones publicly", async () => {
    const p = await makeProduct();
    const blocked = await createSource(ctx(), {
      sourceName: "No-rights images",
      sourceType: "retailer",
      usagePermitted: false,
    });
    const first = await uploadProductImage(ctx(), png(), {
      productId: p.id,
      altText: "Front view",
      licenseType: "Own photo",
    });
    const second = await uploadProductImage(ctx(), png(), {
      productId: p.id,
      altText: "Back view",
      licenseType: "Own photo",
    });
    const hidden = await uploadProductImage(ctx(), png(), {
      productId: p.id,
      altText: "Retailer shot",
      licenseType: "unknown",
      sourceId: blocked.id,
    });
    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);
    expect(existsSync(path.join(UPLOAD_DIR, first.storageKey))).toBe(true);
    expect((await getStorage().get(first.storageKey))?.contentType).toBe("image/png");

    const gallery = await getProductGallery(db(), p.id, null);
    expect(gallery.map((g) => g.alt)).toEqual(["Front view", "Back view"]);
    expect(gallery.some((g) => g.id === hidden.id)).toBe(false);
    expect((await getPrimaryImages(db(), [p.id])).get(p.id)?.src).toBe(
      `/media/${first.storageKey}`,
    );

    await setPrimaryImage(ctx(), second.id);
    const primaries = await db()
      .select()
      .from(productImages)
      .where(eq(productImages.isPrimary, true));
    expect(primaries.filter((i) => i.productId === p.id).map((i) => i.id)).toEqual([second.id]);

    await deleteProductImage(ctx(), second.id);
    expect(existsSync(path.join(UPLOAD_DIR, second.storageKey))).toBe(false);
    const [promoted] = await db()
      .select()
      .from(productImages)
      .where(eq(productImages.id, first.id));
    expect(promoted!.isPrimary).toBe(true);
  });

  it("rejects files that are not what they claim to be", async () => {
    const p = await makeProduct();
    const svg = new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "x.svg", {
      type: "image/svg+xml",
    });
    await expect(
      uploadProductImage(ctx(), svg, { productId: p.id, altText: "Logo", licenseType: "x" }),
    ).rejects.toThrow(/JPEG, PNG or WebP/);
    const disguised = new File([PNG], "x.jpg", { type: "image/jpeg" });
    await expect(
      uploadProductImage(ctx(), disguised, { productId: p.id, altText: "Logo", licenseType: "x" }),
    ).rejects.toThrow(/does not match/);
    await expect(
      uploadProductImage(ctx(), png(), { productId: p.id, altText: "ok", licenseType: "" }),
    ).rejects.toThrow();
  });

  it("freezes a definition's type and unit once products have values", async () => {
    const { category, defs } = await makeSpecCategory();
    const p = await makeProduct({ categoryId: category.id });
    const renamed = await updateSpecificationDefinition(ctx(), defs.weight.id, {
      name: "Weight",
      isFilterable: true,
    });
    expect(renamed).toMatchObject({ name: "Weight", isFilterable: true, dataType: "decimal" });
    await updateSpecificationDefinition(ctx(), defs.note.id, {
      dataType: "enum",
      validationRules: { options: ["A", "B"] },
    });
    await setSpecificationValue(ctx(), { productId: p.id, key: "weight", value: "1.2 kg" });
    await expect(
      updateSpecificationDefinition(ctx(), defs.weight.id, { canonicalUnit: "g" }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      updateSpecificationDefinition(ctx(), defs.weight.id, { dataType: "integer" }),
    ).rejects.toThrow(/cannot change/);
  });

  it("finds likely duplicate brands regardless of case and accents", async () => {
    const b = await makeBrand("Zéphyrion Labs");
    const similar = await findSimilarBrands(db(), "zephyrion labs");
    expect(similar.map((s) => s.id)).toContain(b.id);
    expect(await findSimilarBrands(db(), "zephyrion labs", b.id)).not.toContainEqual(
      expect.objectContaining({ id: b.id }),
    );
  });

  it("accepts only exact redirect hosts for retailers", async () => {
    const base = {
      name: "Demo Shop",
      websiteUrl: "https://shop.demo-retailer.example",
      countryCode: "DE",
      supportedCurrencies: ["EUR"],
    };
    await expect(
      createRetailer(ctx(), { ...base, allowedRedirectHosts: ["*.demo-retailer.example"] }),
    ).rejects.toThrow();
    await expect(
      createRetailer(ctx(), {
        ...base,
        allowedRedirectHosts: ["https://shop.demo-retailer.example/path"],
      }),
    ).rejects.toThrow();
    const r = await createRetailer(ctx(), {
      ...base,
      allowedRedirectHosts: ["Shop.Demo-Retailer.example", "shop.demo-retailer.example"],
    });
    expect(r.allowedRedirectHosts).toEqual(["shop.demo-retailer.example"]);
    const u = await updateRetailer(ctx(), r.id, { isActive: false });
    expect(u).toMatchObject({
      isActive: false,
      allowedRedirectHosts: ["shop.demo-retailer.example"],
      supportedCurrencies: ["EUR"],
    });
  });
});
