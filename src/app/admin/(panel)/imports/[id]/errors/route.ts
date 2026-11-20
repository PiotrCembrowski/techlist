import { csvResponse } from "@/lib/admin/csv-response";
import { requireAdmin } from "@/lib/auth/guard";
import { uuidSchema } from "@/lib/validation";
import { NotFoundError } from "@/modules/_shared/errors";
import { importErrorReportCsv } from "@/modules/imports/service";

/** GET — the import's error report: failed and conflicting rows with their original cells. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return new Response("Not found", { status: 404 });
  try {
    const report = await importErrorReportCsv(ctx.db, id);
    return csvResponse(report.fileName, report.csv);
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
