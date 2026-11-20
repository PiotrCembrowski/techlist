import { NextResponse } from "next/server";
import { getStorage, isValidStorageKey } from "@/lib/storage";

/** Serves uploaded images. Keys are random UUIDs, so responses are immutable. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (!isValidStorageKey(key)) return new NextResponse("Not found", { status: 404 });
  const file = await getStorage().get(key);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
