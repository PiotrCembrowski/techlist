import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkImageUpload,
  isValidStorageKey,
  LocalStorageDriver,
  MAX_IMAGE_BYTES,
  newStorageKey,
  sniffImage,
} from "@/lib/storage";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);

describe("sniffImage", () => {
  it("recognises JPEG, PNG and WebP by magic bytes", () => {
    expect(sniffImage(JPEG)?.ext).toBe("jpg");
    expect(sniffImage(PNG)?.ext).toBe("png");
    expect(sniffImage(WEBP)?.ext).toBe("webp");
  });
  it("refuses SVG, GIF, HTML and truncated input", () => {
    expect(
      sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")),
    ).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("checkImageUpload", () => {
  it("requires a non-empty file within the size limit whose type matches its content", async () => {
    expect((await checkImageUpload(null)).ok).toBe(false);
    expect((await checkImageUpload(new File([], "a.png", { type: "image/png" }))).ok).toBe(false);
    expect(
      (
        await checkImageUpload(
          new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "a.png", { type: "image/png" }),
        )
      ).ok,
    ).toBe(false);
    expect((await checkImageUpload(new File([PNG], "a.jpg", { type: "image/jpeg" }))).ok).toBe(
      false,
    );
    const ok = await checkImageUpload(new File([PNG], "a.png", { type: "image/png" }));
    expect(ok.ok && ok.kind.contentType).toBe("image/png");
  });
});

describe("storage keys", () => {
  it("accepts only generated keys", () => {
    expect(isValidStorageKey(newStorageKey("products", "jpg"))).toBe(true);
    expect(isValidStorageKey(newStorageKey("brands", "webp"))).toBe(true);
    for (const bad of [
      "../etc/passwd",
      "products/../../x.jpg",
      "products/abc.jpg",
      "other/00000000-0000-4000-8000-000000000000.jpg",
      "products/00000000-0000-4000-8000-000000000000.svg",
      "/products/00000000-0000-4000-8000-000000000000.jpg",
    ]) {
      expect(isValidStorageKey(bad), bad).toBe(false);
    }
  });
});

describe("LocalStorageDriver", () => {
  const dirs: string[] = [];
  afterAll(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

  it("stores, reads and deletes files inside its root and never overwrites", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "storage-test-"));
    dirs.push(root);
    const driver = new LocalStorageDriver(root);
    const key = newStorageKey("products", "png");
    await driver.put(key, PNG, "image/png");
    expect(await driver.get(key)).toEqual({ body: PNG, contentType: "image/png" });
    await expect(driver.put(key, JPEG, "image/jpeg")).rejects.toThrow();
    await driver.delete(key);
    expect(await driver.get(key)).toBeNull();
    await expect(driver.put("../escape.png", PNG, "image/png")).rejects.toThrow(
      /Invalid storage key/,
    );
    expect(await driver.get("../escape.png")).toBeNull();
  });
});
