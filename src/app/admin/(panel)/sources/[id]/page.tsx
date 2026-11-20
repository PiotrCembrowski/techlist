import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { uuidSchema } from "@/lib/validation";
import { getSourceById } from "@/modules/sources/service";
import { updateSourceAction } from "../actions";
import { SourceFields } from "../source-form";

export const metadata = { title: "Edit source" };

export default async function EditSource({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const source = await getSourceById(ctx.db, id);
  if (!source) notFound();
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/sources" className="text-sm text-primary">
          ← Sources
        </Link>
        <h1 className="text-4xl">{source.sourceName}</h1>
      </div>
      {(await searchParams).created ? (
        <p role="status" className="border border-success/40 px-3 py-2 text-sm text-success">
          Source created.
        </p>
      ) : null}
      <ActionForm action={updateSourceAction} aria-label="Source" className="max-w-[860px]">
        <SourceFields source={source} />
      </ActionForm>
    </>
  );
}
