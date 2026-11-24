import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { getEnv } from "@/config/env";

/** Where uploaded files live. Keys are random; callers never choose paths (SPEC §13). */
export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** null when the object does not exist. */
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

/** Storage keys: "<folder>/<uuid>.<ext>", nothing else (no traversal, no user-chosen names). */
const KEY_PATTERN = /^(products|brands)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

const EXT_TYPE: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export class LocalStorageDriver implements StorageDriver {
  readonly name = "local";
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    if (!isValidStorageKey(key)) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  /** The content type is derived from the key's extension on read, so it is not stored. */
  async put(key: string, body: Uint8Array, _contentType?: string) {
    void _contentType;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, { flag: "wx" }); // never overwrite
  }

  async get(key: string) {
    try {
      const body = await readFile(this.resolve(key));
      return { body: new Uint8Array(body), contentType: EXT_TYPE[key.split(".").pop()!]! };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/** S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, …). */
export class S3StorageDriver implements StorageDriver {
  readonly name = "s3";
  private clientPromise: Promise<S3Client>;

  constructor(
    private readonly bucket: string,
    config: { region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string },
  ) {
    this.clientPromise = import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          region: config.region,
          endpoint: config.endpoint,
          forcePathStyle: Boolean(config.endpoint),
          credentials:
            config.accessKeyId && config.secretAccessKey
              ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
              : undefined,
        }),
    );
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    if (!isValidStorageKey(key)) throw new Error("Invalid storage key");
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string) {
    if (!isValidStorageKey(key)) return null;
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const res = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? { body: bytes, contentType: res.ContentType ?? EXT_TYPE[key.split(".").pop()!]! } : null;
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    if (!isValidStorageKey(key)) return;
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let driver: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const env = getEnv();
  if (env.STORAGE_DRIVER === "s3") {
    if (!env.S3_BUCKET || !env.S3_REGION) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET and S3_REGION");
    driver = new S3StorageDriver(env.S3_BUCKET, {
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  } else {
    driver = new LocalStorageDriver(path.resolve(/* turbopackIgnore: true */ process.cwd(), env.STORAGE_LOCAL_DIR));
  }
  return driver;
}

// ─── Upload validation ─────────────────────────────────────────────────────────────────

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageKind = { ext: "jpg" | "png" | "webp"; contentType: string };

/** Detects the real file type from magic bytes. SVG and everything else is refused (XSS risk). */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) {
    return { ext: "png", contentType: "image/png" };
  }
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === "RIFF" &&
    String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === "WEBP"
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

export type UploadCheck = { ok: true; kind: ImageKind; bytes: Uint8Array } | { ok: false; message: string };

/** Validates an uploaded File: size, declared MIME type and magic bytes must agree. */
export async function checkImageUpload(file: File | null | undefined): Promise<UploadCheck> {
  if (!file || file.size === 0) return { ok: false, message: "Choose an image file" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, message: "Images must be 5 MB or smaller" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, message: "Only JPEG, PNG or WebP images are accepted" };
  if (file.type && file.type !== kind.contentType) {
    return { ok: false, message: "The file's type does not match its contents" };
  }
  return { ok: true, kind, bytes };
}

export function newStorageKey(folder: "products" | "brands", ext: ImageKind["ext"]): string {
  return `${folder}/${randomUUID()}.${ext}`;
}
