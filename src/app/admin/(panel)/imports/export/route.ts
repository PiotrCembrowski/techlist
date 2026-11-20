import { csvResponse, slugParam } from "@/lib/admin/csv-response";
import { requireAdmin } from "@/lib/auth/guard";
import { NotFoundError } from "@/modules/_shared/errors";
import { exportOffersCsv, exportProductsCsv } from "@/modules/imports/export";

/** GET ?type=products&category=<slug> | ?type=offers[&retailer=<slug>] — round-trippable exports. */
export async function GET(request: Request) {
  const { ctx } = await requireAdmin();
  const q = new URL(request.url).searchParams;
  const stamp = new Date().toISOString().slice(0, 10);
  if (q.get("type") === "offers") {
    const retailer = slugParam(q.get("retailer"));
    return csvResponse(
      `offers${retailer ? `-${retailer}` : ""}-${stamp}.csv`,
      await exportOffersCsv(ctx.db, retailer),
    );
  }
  const category = slugParam(q.get("category"));
  if (!category) return new Response("Choose a category", { status: 400 });
  try {
    return csvResponse(
      `products-${category}-${stamp}.csv`,
      await exportProductsCsv(ctx.db, category),
    );
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Unknown category", { status: 404 });
    throw e;
  }
}
