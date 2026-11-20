import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { clientAddress, PostgresRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { PostgresSearchService } from "@/modules/search/service";

export const dynamic = "force-dynamic";

const querySchema = z.object({ q: z.string().trim().max(100) });

/** 60 suggestion requests per minute per client; typing is debounced client-side. */
const LIMIT = 60;
const WINDOW_SECONDS = 60;

export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse({ q: req.nextUrl.searchParams.get("q") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 });

  const db = getDb();
  const limit = await new PostgresRateLimiter(db).consume(
    rateLimitKey("suggest", clientAddress(req.headers)),
    LIMIT,
    WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  const result = await new PostgresSearchService(db).suggest(parsed.data.q);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
