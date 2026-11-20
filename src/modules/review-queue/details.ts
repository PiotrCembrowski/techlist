import { eq, sql } from "drizzle-orm";
import {
  productSpecifications,
  retailerOffers,
  sources,
  specificationDefinitions,
} from "@/db/schema";
import type { DbOrTx } from "@/lib/db";
import { formatSpecValue } from "@/lib/format";
import type { ReviewItem } from "./service";

export interface ReviewDetails {
  product: { id: string; name: string; brand: string; href: string | null } | null;
  /** Label/value pairs shown to the reviewer. */
  facts: { label: string; value: string; href?: string }[];
  /** For edit-then-approve: the current raw value to prefill. */
  editable: { label: string; defaultValue: string; hint?: string } | null;
  /** For import conflicts: the choices the reviewer picks from. */
  choices: { value: string; label: string }[] | null;
  approveLabel: string;
  rejectLabel: string;
  canMarkVerified: boolean;
}

type Columns = {
  valueText: string | null;
  valueNumeric: number | string | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: string[] | null;
};

async function productInfo(db: DbOrTx, productId: string | null | undefined) {
  if (!productId) return null;
  const [p] = await db.execute<{
    id: string;
    name: string;
    brand: string;
    slug: string;
    brand_slug: string;
    publication_status: string;
  }>(sql`
    SELECT p.id, p.name, b.name AS brand, p.slug, b.slug AS brand_slug, p.publication_status
    FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.id = ${productId}`);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    href: p.publication_status === "published" ? `/products/${p.brand_slug}/${p.slug}` : null,
  };
}

/** Everything the review screen shows for one item, by type. */
export async function getReviewDetails(db: DbOrTx, item: ReviewItem): Promise<ReviewDetails> {
  const p = item.payload as Record<string, unknown>;
  const base: ReviewDetails = {
    product: null,
    facts: [],
    editable: null,
    choices: null,
    approveLabel: "Approve",
    rejectLabel: "Reject",
    canMarkVerified: false,
  };

  switch (item.itemType) {
    case "conflicting_value":
    case "unverified_spec": {
      const [spec] = await db
        .select()
        .from(productSpecifications)
        .where(eq(productSpecifications.id, item.entityId!));
      const [def] = spec
        ? await db
            .select()
            .from(specificationDefinitions)
            .where(eq(specificationDefinitions.id, spec.specificationDefinitionId))
        : [];
      const product = await productInfo(db, p.productId as string);
      const facts: ReviewDetails["facts"] = [
        { label: "Specification", value: def?.name ?? String(p.key) },
      ];
      if (!spec || !def)
        return {
          ...base,
          product,
          facts: [...facts, { label: "Status", value: "The value no longer exists" }],
        };
      if (item.itemType === "conflicting_value") {
        const proposed = p.proposed as Columns;
        const [src] = p.proposedSourceId
          ? await db
              .select({ name: sources.sourceName })
              .from(sources)
              .where(eq(sources.id, p.proposedSourceId as string))
          : [];
        facts.push(
          { label: "Current (verified)", value: formatSpecValue(def, spec) ?? "—" },
          { label: "Proposed", value: formatSpecValue(def, proposed) ?? "—" },
          {
            label: "Proposed by",
            value: `${String(p.origin ?? "manual").replace("_", " ")}${src ? ` · ${src.name}` : ""}`,
          },
        );
        return {
          ...base,
          product,
          facts,
          editable: {
            label: "Value to apply",
            defaultValue: rawOf(def, proposed),
            hint: "Edit before approving if needed. The applied value is marked verified.",
          },
          approveLabel: "Replace the verified value",
          rejectLabel: "Keep the current value",
        };
      }
      facts.push(
        { label: "Extracted value", value: formatSpecValue(def, spec) ?? "—" },
        {
          label: "Confidence",
          value: p.confidence == null ? "—" : `${Math.round(Number(p.confidence) * 100)}%`,
        },
      );
      return {
        ...base,
        product,
        facts,
        editable: {
          label: "Value to verify",
          defaultValue: rawOf(def, spec),
          hint: "Correct it if needed. Approving marks it verified.",
        },
        approveLabel: "Verify value",
        rejectLabel: "Remove value",
      };
    }
    case "suspicious_price": {
      const [offer] = await db
        .select()
        .from(retailerOffers)
        .where(eq(retailerOffers.id, item.entityId!));
      return {
        ...base,
        product: await productInfo(db, p.productId as string),
        facts: [
          { label: "Price", value: `${Number(p.price).toFixed(2)} ${p.currency}` },
          {
            label: "Median of other offers",
            value:
              p.median == null
                ? "—"
                : `${Number(p.median).toFixed(2)} ${p.currency} (${p.compared} offers)`,
          },
          ...(offer
            ? [
                {
                  label: "Offer",
                  value: offer.isActive ? "active" : "inactive",
                  href: `/admin/offers/${offer.id}`,
                },
              ]
            : []),
        ],
        approveLabel: "Price is correct",
        rejectLabel: "Price is wrong — hide the offer",
      };
    }
    case "new_product": {
      const product = await productInfo(db, item.entityId);
      return {
        ...base,
        product,
        facts: [
          { label: "Created by", value: p.source === "import" ? "CSV import (draft)" : "—" },
          ...(product
            ? [
                {
                  label: "Edit",
                  value: "Open in the product editor",
                  href: `/admin/products/${product.id}`,
                },
              ]
            : []),
        ],
        approveLabel: "Approve and publish",
        rejectLabel: "Archive",
      };
    }
    case "correction": {
      const product = await productInfo(db, p.productId as string);
      const [def] = p.key
        ? await db.execute<{ name: string }>(sql`
            SELECT d.name FROM specification_definitions d WHERE d.key = ${p.key as string} LIMIT 1`)
        : [];
      return {
        ...base,
        product,
        facts: [
          { label: "Specification", value: def?.name ?? "General (no specific field)" },
          { label: "Suggested value", value: String(p.value) },
          { label: "Source", value: String(p.sourceUrl), href: String(p.sourceUrl) },
          { label: "Contact", value: p.email ? String(p.email) : "none given" },
        ],
        editable: p.key
          ? {
              label: "Value to apply",
              defaultValue: String(p.value),
              hint: "Check it against the source first.",
            }
          : null,
        canMarkVerified: Boolean(p.key),
        approveLabel: p.key ? "Apply correction" : "Mark as handled",
        rejectLabel: "Reject",
      };
    }
    case "duplicate_candidate":
    case "variant_ambiguity": {
      const row = p.row as {
        brand: string;
        productName: string;
        modelNumber: string | null;
        variant: { name: string; regionCode?: string | null } | null;
      } | null;
      const candidates = (p.candidates as { id: string; name: string; score?: number }[]) ?? [];
      const facts: ReviewDetails["facts"] = [
        { label: "Reason", value: String(p.reason ?? "") },
        {
          label: "Import row",
          value: `Row ${p.rowNumber}: ${row?.brand ?? ""} ${row?.productName ?? ""}${row?.modelNumber ? ` (${row.modelNumber})` : ""}${row?.variant ? ` · ${row.variant.name}${row.variant.regionCode ? ` · ${row.variant.regionCode}` : ""}` : ""}`,
          href: `/admin/imports/${p.jobId}`,
        },
      ];
      if (item.itemType === "duplicate_candidate") {
        return {
          ...base,
          facts,
          choices: [
            ...candidates.map((c) => ({
              value: c.id,
              label: `Same product as ${c.name}${c.score ? ` (similarity ${c.score})` : ""} — update it`,
            })),
            { value: "new", label: "A different product — create it as a draft" },
          ],
          approveLabel: "Apply the row",
          rejectLabel: "Discard the row",
        };
      }
      const [variant] = candidates[0]
        ? await db.execute<{ product_id: string; region_code: string | null }>(
            sql`SELECT product_id, region_code FROM product_variants WHERE id = ${candidates[0].id}`,
          )
        : [];
      return {
        ...base,
        product: await productInfo(db, variant?.product_id),
        facts,
        choices: [
          ...candidates.map((c) => ({
            value: c.id,
            label: `Same variant as “${c.name}” (${variant?.region_code ?? "global"}) — update it`,
          })),
          { value: "new", label: "A separate variant — create it" },
        ],
        approveLabel: "Apply the row",
        rejectLabel: "Discard the row",
      };
    }
  }
}

/** A stored value as editable text in the canonical unit. */
function rawOf(def: { dataType: string; canonicalUnit: string | null }, v: Columns): string {
  if (v.valueNumeric !== null)
    return `${Number(v.valueNumeric)}${def.canonicalUnit ? ` ${def.canonicalUnit}` : ""}`;
  if (v.valueBoolean !== null) return v.valueBoolean ? "yes" : "no";
  if (v.valueJson) return v.valueJson.join(", ");
  return v.valueDate ?? v.valueText ?? "";
}
