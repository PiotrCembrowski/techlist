import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminSection, CheckboxField, TextArea, TextField } from "@/components/admin/fields";
import { ActionForm, FieldError, SubmitButton } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { formatDate } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { getReviewDetails } from "@/modules/review-queue/details";
import { getReviewItem, REVIEW_TYPES } from "@/modules/review-queue/service";
import { approveReviewAction, rejectReviewAction } from "../actions";

export const metadata = { title: "Review item" };

export default async function ReviewItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const item = await getReviewItem(ctx.db, id);
  if (!item) notFound();
  const d = await getReviewDetails(ctx.db, item);
  const type = REVIEW_TYPES.find((t) => t.value === item.itemType)?.single ?? item.itemType;
  const open = item.status === "open";

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/review" className="text-sm text-primary">
          ← Review queue
        </Link>
        <h1 className="text-4xl">{type}</h1>
        {d.product ? (
          <p className="text-sm">
            {d.product.brand} {d.product.name} ·{" "}
            <Link href={`/admin/products/${d.product.id}`} className="text-primary">
              Edit product
            </Link>
            {d.product.href ? (
              <>
                {" · "}
                <Link href={d.product.href} className="text-primary">
                  Public page
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <AdminSection title="Details">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
          {d.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="break-words">
                {f.href ? (
                  f.href.startsWith("/") ? (
                    <Link href={f.href} className="text-primary">
                      {f.value}
                    </Link>
                  ) : (
                    <a
                      href={f.href}
                      className="text-primary"
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                    >
                      {f.value}
                    </a>
                  )
                ) : (
                  f.value
                )}
              </dd>
            </div>
          ))}
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            {item.status}
            {item.resolvedAt ? ` on ${formatDate(item.resolvedAt)}` : ""}
            {item.resolutionNote ? ` — “${item.resolutionNote}”` : ""}
          </dd>
        </dl>
      </AdminSection>

      {open ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <AdminSection title="Approve">
            <ActionForm action={approveReviewAction} aria-label="Approve">
              <input type="hidden" name="id" value={item.id} />
              {d.choices ? (
                <fieldset className="flex flex-col gap-2" aria-describedby="f-choice-err">
                  <legend className="mb-1 text-[13px] font-medium">What is this row?</legend>
                  {d.choices.map((c, i) => (
                    <label key={c.value} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="choice"
                        value={c.value}
                        required
                        defaultChecked={i === 0 && d.choices!.length === 1}
                        className="mt-0.5 size-4 accent-[var(--primary)]"
                      />
                      {c.label}
                    </label>
                  ))}
                  <FieldError name="choice" id="f-choice-err" />
                </fieldset>
              ) : null}
              {d.editable ? (
                <TextField
                  name="value"
                  label={d.editable.label}
                  defaultValue={d.editable.defaultValue}
                  hint={d.editable.hint}
                />
              ) : null}
              {d.canMarkVerified ? (
                <CheckboxField
                  name="markVerified"
                  label="I checked the value against the cited source (mark it verified)"
                  hint="Required to replace a verified value."
                />
              ) : null}
              <TextArea name="note" label="Note (optional)" rows={2} />
              <SubmitButton>{d.approveLabel}</SubmitButton>
            </ActionForm>
          </AdminSection>
          <AdminSection title="Reject">
            <ActionForm action={rejectReviewAction} aria-label="Reject">
              <input type="hidden" name="id" value={item.id} />
              <TextArea idPrefix="reject" name="note" label="Reason" required rows={2} />
              <SubmitButton variant="danger">{d.rejectLabel}</SubmitButton>
            </ActionForm>
          </AdminSection>
        </div>
      ) : null}
    </>
  );
}
