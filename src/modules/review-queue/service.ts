import { count, eq, sql } from "drizzle-orm";
import {
  importJobs,
  productSpecifications,
  reviewItems,
  sources,
  specificationDefinitions,
} from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import type { ProductRowData } from "@/modules/imports/products";
import { slugify } from "@/lib/validation";
import { recordAudit } from "@/modules/audit/service";
import { inTransaction, type ServiceContext, type Tx } from "@/modules/_shared/context";
import { InvalidStateError, NotFoundError, ValidationError } from "@/modules/_shared/errors";

export type ReviewItem = typeof reviewItems.$inferSelect;
export type ReviewItemType = ReviewItem["itemType"];
type NewReviewItem = typeof reviewItems.$inferInsert;

export const REVIEW_TYPES: { value: ReviewItemType; label: string; single: string }[] = [
  { value: "conflicting_value", label: "Conflicting values", single: "Conflicting value" },
  { value: "unverified_spec", label: "Unverified values", single: "Unverified value" },
  { value: "duplicate_candidate", label: "Possible duplicates", single: "Possible duplicate" },
  { value: "variant_ambiguity", label: "Variant ambiguity", single: "Variant ambiguity" },
  { value: "new_product", label: "New products", single: "New product" },
  { value: "correction", label: "Corrections", single: "Reader correction" },
  { value: "suspicious_price", label: "Suspicious prices", single: "Suspicious price" },
];

/** Queue an item for human review. */
export async function createReviewItem(
  tx: DbOrTx,
  item: Pick<NewReviewItem, "itemType" | "entityType" | "entityId" | "payload" | "createdBy">,
) {
  const [row] = await tx.insert(reviewItems).values(item).returning();
  return row!;
}

// ─── Reads ─────────────────────────────────────────────────────────────────────────────

export type ReviewListRow = {
  id: string;
  item_type: ReviewItemType;
  status: string;
  created_at: string;
  resolved_at: string | null;
  product_id: string | null;
  product_name: string | null;
  brand_name: string | null;
  summary: string | null;
};

/** Paginated queue, newest first, with the product each item is about (one query). */
export async function listReviewItems(
  db: DbOrTx,
  opts: {
    status?: "open" | "approved" | "rejected";
    type?: ReviewItemType | null;
    page?: number;
  } = {},
) {
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  const rows = await db.execute<ReviewListRow>(sql`
    SELECT r.id, r.item_type, r.status, r.created_at::text, r.resolved_at::text,
           p.id AS product_id, p.name AS product_name, b.name AS brand_name,
           coalesce(r.payload->'row'->>'productName', r.payload->>'key', r.payload->>'reason', r.payload->>'name') AS summary
    FROM review_items r
    LEFT JOIN products p ON p.id = coalesce(
      CASE WHEN r.payload->>'productId' ~ '^[0-9a-f-]{36}$' THEN (r.payload->>'productId')::uuid END,
      CASE WHEN r.entity_type = 'product' THEN r.entity_id END)
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE r.status = ${opts.status ?? "open"} ${opts.type ? sql`AND r.item_type = ${opts.type}` : sql``}
    ORDER BY r.created_at DESC, r.id LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`);
  return { items: rows.slice(0, pageSize), page, hasNext: rows.length > pageSize };
}

export async function countOpenReviewItems(db: DbOrTx) {
  const rows = await db
    .select({ type: reviewItems.itemType, n: count() })
    .from(reviewItems)
    .where(eq(reviewItems.status, "open"))
    .groupBy(reviewItems.itemType);
  return new Map(rows.map((r) => [r.type, Number(r.n)]));
}

export async function getReviewItem(db: DbOrTx, id: string): Promise<ReviewItem | null> {
  const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
  return row ?? null;
}

// ─── Resolution ────────────────────────────────────────────────────────────────────────

export interface ApproveInput {
  note?: string | null;
  /** Edit-then-approve: a replacement value (spec items and corrections). */
  value?: string | null;
  /** Corrections: also mark the applied value as verified. */
  markVerified?: boolean;
  /** Duplicate candidates: "new" or an existing product id. Variant ambiguity: "new" or a variant id. */
  choice?: string | null;
}

async function lockOpen(tx: Tx, id: string): Promise<ReviewItem> {
  const [item] = await tx.select().from(reviewItems).where(eq(reviewItems.id, id)).for("update");
  if (!item) throw new NotFoundError("Review item", id);
  if (item.status !== "open") throw new InvalidStateError("This item has already been resolved");
  return item;
}

/** Personal data is only kept while an item is open (data minimisation). */
function withoutPersonalData(payload: Record<string, unknown>) {
  const { email: _e, ...rest } = payload;
  void _e;
  return rest;
}

async function finish(
  tx: Tx,
  ctx: ServiceContext,
  item: ReviewItem,
  status: "approved" | "rejected",
  note: string | null,
  payload?: Record<string, unknown>,
) {
  const [row] = await tx
    .update(reviewItems)
    .set({
      status,
      resolvedBy: ctx.actorId,
      resolvedAt: new Date(),
      resolutionNote: note,
      payload: withoutPersonalData(payload ?? item.payload),
    })
    .where(eq(reviewItems.id, item.id))
    .returning();
  await recordAudit(tx, {
    actorId: ctx.actorId,
    entityType: "review_item",
    entityId: item.id,
    action: status === "approved" ? "approve" : "reject",
    previous: { status: item.status, itemType: item.itemType },
    next: {
      status,
      note,
      resolution: (payload as { resolution?: unknown } | undefined)?.resolution ?? null,
    },
  });
  return row!;
}

/** Applies a value to a stored specification row and marks it verified by this reviewer. */
async function applySpecValue(
  tx: Tx,
  ctx: ServiceContext,
  specId: string,
  columns: Record<string, unknown> | null,
  rawEdit: string | null | undefined,
  extra: Record<string, unknown> = {},
) {
  const [spec] = await tx
    .select()
    .from(productSpecifications)
    .where(eq(productSpecifications.id, specId))
    .for("update");
  if (!spec) throw new InvalidStateError("The specification value no longer exists");
  let value = columns;
  if (rawEdit) {
    const [def] = await tx
      .select()
      .from(specificationDefinitions)
      .where(eq(specificationDefinitions.id, spec.specificationDefinitionId));
    const { parseSpecificationValue } = await import("@/modules/specifications/parse");
    value = parseSpecificationValue(def!, rawEdit) as unknown as Record<string, unknown>;
  }
  const [row] = await tx
    .update(productSpecifications)
    .set({ ...(value ?? {}), ...extra, verificationStatus: "verified", lastVerifiedAt: new Date() })
    .where(eq(productSpecifications.id, specId))
    .returning();
  await recordAudit(tx, {
    actorId: ctx.actorId,
    entityType: "product_specification",
    entityId: specId,
    action: "review_apply",
    previous: spec,
    next: row,
  });
}

/** Source used for values that come from reviewed reader corrections. */
async function correctionsSource(tx: Tx, ctx: ServiceContext): Promise<string> {
  const name = "Reader corrections (reviewed)";
  const [found] = await tx
    .select({ id: sources.id })
    .from(sources)
    .where(sql`lower(${sources.sourceName}) = lower(${name})`);
  if (found) return found.id;
  const { createSource } = await import("@/modules/sources/service");
  const s = await createSource(
    { db: tx, actorId: ctx.actorId },
    {
      sourceName: name,
      sourceType: "community_submission",
      accessMethod: "Public correction form, checked by an editor against the cited source",
      usagePermitted: true,
    },
  );
  return s.id;
}

/**
 * Approves an item and applies its change in the same transaction (SPEC §9.7). Edit-then-approve
 * passes `value`. Every approval is audited.
 */
export async function approveReviewItem(
  ctx: ServiceContext,
  id: string,
  input: ApproveInput = {},
): Promise<ReviewItem> {
  const note = input.note?.trim() || null;
  return inTransaction(ctx, async (tx) => {
    const item = await lockOpen(tx, id);
    const sctx = { db: tx, actorId: ctx.actorId };
    const p = item.payload as Record<string, unknown>;
    switch (item.itemType) {
      case "conflicting_value":
        await applySpecValue(
          tx,
          ctx,
          item.entityId!,
          p.proposed as Record<string, unknown>,
          input.value,
          {
            sourceId: (p.proposedSourceId as string | null) ?? undefined,
            origin: (p.origin as "manual" | "import" | "ai_extracted") ?? "manual",
            confidence: (p.confidence as number | null) ?? null,
          },
        );
        return finish(tx, ctx, item, "approved", note);
      case "unverified_spec":
        await applySpecValue(tx, ctx, item.entityId!, null, input.value);
        return finish(tx, ctx, item, "approved", note);
      case "suspicious_price":
        // The price was checked and is correct: nothing to change.
        return finish(tx, ctx, item, "approved", note);
      case "new_product": {
        const { getProductById, publishProduct } = await import("@/modules/products/service");
        const product = await getProductById(tx, item.entityId!);
        if (!product) throw new InvalidStateError("The product no longer exists");
        if (product.publicationStatus === "draft") await publishProduct(sctx, product.id);
        return finish(tx, ctx, item, "approved", note);
      }
      case "correction": {
        const key = p.key as string | null;
        const productId = p.productId as string;
        if (key) {
          const raw = input.value?.trim() || (p.value as string);
          const { setSpecificationValue } = await import("@/modules/specifications/service");
          const r = await setSpecificationValue(sctx, {
            productId,
            key,
            value: raw,
            sourceId: await correctionsSource(tx, ctx),
            origin: "manual",
            verificationStatus: input.markVerified ? "verified" : "unverified",
          });
          if (r.outcome === "review_required") {
            throw new ValidationError(
              "The current value is verified: tick “verified” to replace it with the checked value",
            );
          }
        }
        return finish(tx, ctx, item, "approved", note);
      }
      case "duplicate_candidate":
      case "variant_ambiguity":
        return approveImportRow(tx, ctx, item, input, note);
    }
  });
}

/** Import conflicts: apply the stored row according to the reviewer's choice. */
async function approveImportRow(
  tx: Tx,
  ctx: ServiceContext,
  item: ReviewItem,
  input: ApproveInput,
  note: string | null,
) {
  const p = item.payload as {
    jobId: string;
    rowNumber: number;
    rowHash: string;
    candidates: { id: string; name: string }[];
    row: ProductRowData;
    productId?: string;
  };
  const choice = input.choice?.trim();
  if (!choice)
    throw new ValidationError("Choose what this row is", [
      { path: "choice", message: "Choose an option" },
    ]);
  if (choice !== "new" && !p.candidates.some((c) => c.id === choice))
    throw new ValidationError("Choose one of the listed options");
  const [job] = await tx
    .select({ sourceId: importJobs.sourceId })
    .from(importJobs)
    .where(eq(importJobs.id, p.jobId));
  const [source] = job ? await tx.select().from(sources).where(eq(sources.id, job.sourceId)) : [];
  if (!source?.usagePermitted)
    throw new InvalidStateError("The import's source no longer permits use of its data");

  const row = structuredClone(p.row);
  let resolution: Record<string, unknown>;
  if (item.itemType === "duplicate_candidate") {
    resolution = choice === "new" ? { newProduct: true } : { productId: choice };
  } else {
    const productId = (
      await tx.execute<{ product_id: string }>(
        sql`SELECT product_id FROM product_variants WHERE id = ${p.candidates[0]!.id}`,
      )
    )[0]?.product_id;
    if (!productId) throw new InvalidStateError("The matched variant no longer exists");
    if (choice === "new" && row.variant) {
      // A distinct code so the new regional variant never collides with the existing one.
      const base = row.variant.code ?? slugify(row.variant.name);
      row.variant.code = `${base}-${(row.variant.regionCode ?? "global").toLowerCase()}`.slice(
        0,
        120,
      );
    }
    resolution =
      choice === "new" ? { productId, newVariant: true } : { productId, variantId: choice };
  }
  // Store the decision first: the planner reads it (same transaction) by row hash.
  await tx
    .update(reviewItems)
    .set({
      status: "approved",
      resolvedAt: new Date(),
      resolvedBy: ctx.actorId,
      payload: { ...p, resolution },
    })
    .where(eq(reviewItems.id, item.id));
  const { planProductRows, applyProductPlan } = await import("@/modules/imports/products");
  const [plan] = await planProductRows(
    tx,
    [{ idx: 0, rowNumber: p.rowNumber, hash: p.rowHash, data: row, issues: [] }],
    source,
  );
  if (!plan || plan.action === "error" || plan.action === "conflict") {
    throw new ValidationError(
      `The row cannot be applied: ${plan?.issues.map((i) => i.message).join("; ") || plan?.notes.join("; ") || "unknown reason"}`,
    );
  }
  let applied = { productId: plan.productId, variantId: plan.variantId };
  if (plan.action !== "skip") {
    const r = await applyProductPlan({ db: tx, actorId: ctx.actorId }, plan, {
      created: new Map(),
    });
    applied = { productId: r.productId, variantId: r.variantId };
  }
  // Remember what the row became, so re-importing the same row updates it instead of asking again.
  const final = {
    ...resolution,
    productId: applied.productId,
    ...(applied.variantId ? { variantId: applied.variantId } : {}),
  };
  return finish(tx, ctx, { ...item, status: "open" }, "approved", note, {
    ...p,
    row,
    resolution: final,
  });
}

/** Rejects an item with a note. Side effects: see the switch. */
export async function rejectReviewItem(
  ctx: ServiceContext,
  id: string,
  noteInput: string,
): Promise<ReviewItem> {
  const note = noteInput.trim();
  if (!note)
    throw new ValidationError("Say why you reject this item", [
      { path: "note", message: "A note is required" },
    ]);
  return inTransaction(ctx, async (tx) => {
    const item = await lockOpen(tx, id);
    const sctx = { db: tx, actorId: ctx.actorId };
    switch (item.itemType) {
      case "suspicious_price": {
        // The price is wrong: hide the offer until someone fixes it.
        const { updateRetailerOffer } = await import("@/modules/offers/service");
        await updateRetailerOffer(sctx, item.entityId!, { isActive: false }).catch((e) => {
          if (!(e instanceof NotFoundError)) throw e;
        });
        break;
      }
      case "new_product": {
        const { getProductById, archiveProduct } = await import("@/modules/products/service");
        const product = await getProductById(tx, item.entityId!);
        if (product && product.publicationStatus === "draft")
          await archiveProduct(sctx, product.id);
        break;
      }
      case "unverified_spec": {
        // A rejected AI-extracted value is removed rather than left unverified.
        const [spec] = await tx
          .select()
          .from(productSpecifications)
          .where(eq(productSpecifications.id, item.entityId!));
        if (spec && spec.verificationStatus !== "verified") {
          await tx.delete(productSpecifications).where(eq(productSpecifications.id, spec.id));
          await recordAudit(tx, {
            actorId: ctx.actorId,
            entityType: "product_specification",
            entityId: spec.id,
            action: "delete",
            previous: spec,
          });
        }
        break;
      }
      default:
        // conflicting_value: the verified value stays. Import conflicts: the row is skipped on
        // re-import. Corrections: nothing changes.
        break;
    }
    return finish(tx, ctx, item, "rejected", note);
  });
}
