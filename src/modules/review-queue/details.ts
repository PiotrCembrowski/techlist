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
    status: string;
  }>(sql`
    SELECT p.id, p.name, b.name AS brand, p.slug, b.slug AS brand_slug, p.status
    FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.id = ${productId}`);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    href: p.status === "published" ? `/products/${p.brand_slug}/${p.slug}` : null,
  };
}

async function sourceName(db: DbOrTx, sourceId: unknown): Promise<string | null> {
  if (typeof sourceId !== "string") return null;
  const [s] = await db
    .select({ name: sources.sourceName })
    .from(sources)
    .where(eq(sources.id, sourceId));
  return s?.name ?? null;
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
          { label: "Created by", value: p.source === "import" ? "Import (needs review)" : "—" },
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
        approveLabel: "Verify and publish",
        rejectLabel: "Reject product",
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
    case "field_conflict": {
      const product = await productInfo(db, p.productId as string);
      const source = await sourceName(db, p.sourceId);
      const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
      return {
        ...base,
        product,
        facts: [
          { label: "Field", value: String(p.field) + (p.variantId ? " (variant)" : "") },
          { label: "Current value", value: show(p.current) },
          { label: "Proposed value", value: show(p.proposed) },
          { label: "Source", value: source ?? "—" },
        ],
        editable: {
          label: "Value to apply",
          defaultValue: show(p.proposed) === "—" ? "" : String(p.proposed),
          hint: "Check it against the source first. Empty clears the field.",
        },
        approveLabel: "Apply value",
        rejectLabel: "Keep current value",
      };
    }
    case "image_rights": {
      const product = await productInfo(db, p.productId as string);
      const url = typeof p.remoteUrl === "string" ? p.remoteUrl : "";
      return {
        ...base,
        product,
        facts: [
          { label: "Image", value: url, href: url },
          { label: "Provider", value: String(p.provider ?? "—") },
          { label: "Author", value: String(p.author ?? "not stated") },
          { label: "Licence", value: String(p.licenseType ?? "not stated") },
          ...(typeof p.licenseUrl === "string"
            ? [{ label: "Licence terms", value: p.licenseUrl, href: p.licenseUrl }]
            : []),
        ],
        approveLabel: "Rights confirmed: show image",
        rejectLabel: "Do not use image",
      };
    }
    case "duplicate_candidate":
    case "variant_ambiguity": {
      if (p.kind === "provider") return providerDetails(db, item, base);
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

/** Provider duplicate / variant-ambiguity items (import system, DECISIONS D79). */
async function providerDetails(
  db: DbOrTx,
  item: ReviewItem,
  base: ReviewDetails,
): Promise<ReviewDetails> {
  const p = item.payload as Record<string, unknown>;
  const rec = (p.product ?? {}) as {
    brand?: { value?: string | null };
    name?: { value?: string | null };
    modelNumber?: { value?: string | null };
    mpn?: { value?: string | null };
    gtins?: string[];
    sourceUrl?: string | null;
    variant?: {
      storage?: string | null;
      memory?: string | null;
      colour?: { value?: string | null };
    };
  };
  const config = [rec.variant?.storage, rec.variant?.memory, rec.variant?.colour?.value]
    .filter(Boolean)
    .join(" · ");
  const facts: ReviewDetails["facts"] = [
    { label: "Reason", value: String(p.reason ?? "") },
    {
      label: `${String(p.provider)} record`,
      value: `${rec.brand?.value ?? ""} ${rec.name?.value ?? ""} (ID ${String(p.providerProductId)})`,
      ...(rec.sourceUrl ? { href: rec.sourceUrl } : {}),
    },
    {
      label: "Model / MPN",
      value: [rec.modelNumber?.value, rec.mpn?.value].filter(Boolean).join(" / ") || "—",
    },
    { label: "GTIN", value: rec.gtins?.join(", ") || "—" },
    { label: "Configuration", value: config || "—" },
  ];
  if (item.itemType === "variant_ambiguity") {
    const product = await productInfo(db, p.productId as string);
    const ids = (p.variantIds as string[]) ?? [];
    const variants = ids.length
      ? await db.execute<{ id: string; variant_name: string }>(sql`
          SELECT id, variant_name FROM product_variants WHERE id = ANY(${sql.param(ids)}::uuid[])`)
      : [];
    return {
      ...base,
      product,
      facts,
      choices: [
        ...variants.map((v) => ({
          value: v.id,
          label: `Same configuration as “${v.variant_name}”`,
        })),
        { value: "new", label: "A new variant of this product" },
      ],
      approveLabel: "Apply",
      rejectLabel: "Do not import",
    };
  }
  const candidates =
    (p.candidates as {
      productId: string;
      name: string;
      rule: string;
      confidence: number;
      reason: string;
    }[]) ?? [];
  for (const c of candidates)
    facts.push({
      label: `Candidate (${c.rule}, ${Math.round(c.confidence * 100)} %)`,
      value: `${c.name} — ${c.reason}`,
      href: `/admin/products/${c.productId}`,
    });
  const unique = [...new Map(candidates.map((c) => [c.productId, c])).values()];
  return {
    ...base,
    facts,
    choices: [
      ...unique.flatMap((c) => [
        { value: c.productId, label: `Same product as ${c.name} (merge)` },
        { value: `variant:${c.productId}`, label: `A variant of ${c.name}` },
      ]),
      { value: "new", label: "A different product (keep separate)" },
    ],
    approveLabel: "Apply",
    rejectLabel: "Do not import",
  };
}
