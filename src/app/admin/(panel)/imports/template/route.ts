import { csvResponse, slugParam } from "@/lib/admin/csv-response";
import { requireAdmin } from "@/lib/auth/guard";
import { NotFoundError } from "@/modules/_shared/errors";
import { offersTemplateCsv, productsTemplateCsv } from "@/modules/imports/export";

/** GET ?type=products[&category=<slug>] | ?type=offers — header-only CSV templates. */
export async function GET(request: Request) {
  const { ctx } = await requireAdmin();
  const q = new URL(request.url).searchParams;
  if (q.get("type") === "offers") return csvResponse("offers-template.csv", offersTemplateCsv());
  const category = slugParam(q.get("category"));
  try {
    return csvResponse(
      `products-template${category ? `-${category}` : ""}.csv`,
      await productsTemplateCsv(ctx.db, category),
    );
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Unknown category", { status: 404 });
    throw e;
  }
}
