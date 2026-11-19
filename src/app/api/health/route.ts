import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + database reachability. */
export async function GET() {
  try {
    await getDb().execute(sql`SELECT 1`);
    return NextResponse.json(
      { status: "ok", database: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error(JSON.stringify({ level: "error", msg: "health check: database unreachable" }));
    return NextResponse.json(
      { status: "degraded", database: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
