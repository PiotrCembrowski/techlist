import { and, desc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import * as s from "@/db/schema";
import type { Database } from "@/lib/db";
import { gtinCheckDigit } from "@/lib/validation";
import { brandInputSchema } from "@/modules/brands/schema";
import { categoryInputSchema } from "@/modules/categories/schema";
import { parseOrThrow } from "@/modules/_shared/errors";
import { productInputSchema } from "@/modules/products/schema";
import {
  assertDefinitionConsistent,
  parseSpecificationValue,
} from "@/modules/specifications/parse";
import { variantBaseSchema } from "@/modules/variants/schema";
import * as data from "./data";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function snake(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * INSERT ... ON CONFLICT DO UPDATE that only rewrites rows whose values actually differ, so a
 * second run leaves every row (including updated_at) untouched.
 */
async function upsert<T extends PgTable>(
  tx: Tx,
  table: T,
  rows: T["$inferInsert"][],
  target: PgColumn[],
  updateKeys: (keyof T["$inferInsert"] & string)[],
) {
  if (rows.length === 0) return;
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const set: Record<string, SQL> = {};
  for (const k of updateKeys) set[k] = sql.raw(`excluded."${snake(k)}"`);
  const current = sql.join(
    updateKeys.map((k) => sql`${cols[k]}`),
    sql`, `,
  );
  const incoming = sql.join(
    updateKeys.map((k) => sql.raw(`excluded."${snake(k)}"`)),
    sql`, `,
  );
  await tx
    .insert(table)
    .values(rows)
    .onConflictDoUpdate({
      target,
      set,
      setWhere: sql`(${current}) IS DISTINCT FROM (${incoming})`,
    });
}

function idMap<K extends string>(rows: { id: string; key: K }[]) {
  return new Map(rows.map((r) => [r.key, r.id]));
}

function need<V>(map: Map<string, V>, key: string, what: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(`Seed data error: unknown ${what} "${key}"`);
  return v;
}

export interface SeedOptions {
  /** Reference time for relative offer timestamps. Defaults to the start of the current UTC hour. */
  now?: Date;
  log?: (msg: string) => void;
}

export function assertSeedAllowed(env: Record<string, string | undefined>) {
  if (env.NODE_ENV === "production" && env.ALLOW_DEMO_SEED !== "true") {
    throw new Error(
      "Refusing to seed demo data with NODE_ENV=production (set ALLOW_DEMO_SEED=true to override).",
    );
  }
}

export async function seedDemoData(db: Database, opts: SeedOptions = {}) {
  const log = opts.log ?? (() => {});
  const anchor = opts.now ?? new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const hoursAgo = (h: number) => new Date(anchor.getTime() - h * 3_600_000);
  const verifiedAt = new Date(data.DEMO_VERIFIED_AT);

  await db.transaction(async (tx) => {
    // ── Source ──
    await tx
      .insert(s.sources)
      .values({ ...data.DEMO_SOURCE, isDemo: true, retrievedAt: verifiedAt })
      .onConflictDoNothing();
    const [source] = await tx
      .select({ id: s.sources.id })
      .from(s.sources)
      .where(sql`lower(${s.sources.sourceName}) = lower(${data.DEMO_SOURCE.sourceName})`);
    const sourceId = source!.id;

    // ── Categories (parents first) ──
    for (const level of [false, true]) {
      const list = data.CATEGORIES.filter((c) => Boolean(c.parent) === level);
      const parents = idMap(
        await tx.select({ id: s.categories.id, key: s.categories.slug }).from(s.categories),
      );
      const rows = list.map((c) => {
        const v = parseOrThrow(categoryInputSchema, {
          name: c.name,
          slug: c.slug,
          description: c.description,
          icon: c.icon,
          sortOrder: c.sortOrder,
          parentId: c.parent ? need(parents, c.parent, "category") : null,
        });
        return { ...v, slug: c.slug };
      });
      await upsert(
        tx,
        s.categories,
        rows,
        [s.categories.slug],
        ["name", "description", "icon", "sortOrder", "parentId"],
      );
    }
    const categoryIds = idMap(
      await tx.select({ id: s.categories.id, key: s.categories.slug }).from(s.categories),
    );

    // ── Specification groups and definitions ──
    for (const [catSlug, schema] of Object.entries(data.SPEC_SCHEMA)) {
      const categoryId = need(categoryIds, catSlug, "category");
      await upsert(
        tx,
        s.specificationGroups,
        schema.groups.map((g) => ({ categoryId, key: g.key, name: g.name, displayOrder: g.order })),
        [s.specificationGroups.categoryId, s.specificationGroups.key],
        ["name", "displayOrder"],
      );
    }
    const groupRows = await tx
      .select({
        id: s.specificationGroups.id,
        key: s.specificationGroups.key,
        categoryId: s.specificationGroups.categoryId,
      })
      .from(s.specificationGroups);
    const categoryParent = new Map(data.CATEGORIES.map((c) => [c.slug, c.parent]));
    const groupId = (catSlug: string, key: string): string => {
      // Groups are inherited: look in the category, then its ancestors.
      for (let cur: string | undefined = catSlug; cur; cur = categoryParent.get(cur)) {
        const cid = need(categoryIds, cur, "category");
        const hit = groupRows.find((g) => g.categoryId === cid && g.key === key);
        if (hit) return hit.id;
      }
      throw new Error(`Seed data error: group "${key}" not found for ${catSlug}`);
    };

    for (const [catSlug, schema] of Object.entries(data.SPEC_SCHEMA)) {
      const categoryId = need(categoryIds, catSlug, "category");
      const rows = schema.definitions.map((d, i) => {
        const def = {
          categoryId,
          groupId: groupId(catSlug, d.group),
          key: d.key,
          name: d.name,
          description: d.description ?? null,
          dataType: d.dataType,
          canonicalUnit: d.unit ?? null,
          displayOrder: (i + 1) * 10,
          isFilterable: d.filterable ?? false,
          isComparable: true,
          isRequired: d.required ?? false,
          isPublic: true,
          comparisonDirection: d.direction ?? ("none" as const),
          validationRules: d.rules ?? {},
        };
        assertDefinitionConsistent(def);
        return def;
      });
      await upsert(
        tx,
        s.specificationDefinitions,
        rows,
        [s.specificationDefinitions.categoryId, s.specificationDefinitions.key],
        [
          "groupId",
          "name",
          "description",
          "dataType",
          "canonicalUnit",
          "displayOrder",
          "isFilterable",
          "isComparable",
          "isRequired",
          "isPublic",
          "comparisonDirection",
          "validationRules",
        ],
      );
    }
    const allDefs = await tx.select().from(s.specificationDefinitions);
    const defsFor = (catSlug: string) => {
      const out = new Map<string, (typeof allDefs)[number]>();
      for (let cur: string | undefined = catSlug; cur; cur = categoryParent.get(cur)) {
        const cid = need(categoryIds, cur, "category");
        for (const d of allDefs) if (d.categoryId === cid && !out.has(d.key)) out.set(d.key, d);
      }
      return out;
    };
    log(`categories: ${categoryIds.size}, definitions: ${allDefs.length}`);

    // ── Brands and families ──
    await upsert(
      tx,
      s.brands,
      data.BRANDS.map((b) => ({
        ...parseOrThrow(brandInputSchema, { ...b, isDemo: true }),
        slug: b.slug,
      })),
      [s.brands.slug],
      ["name", "description", "countryOfOrigin", "aliases", "isDemo", "isActive"],
    );
    const brandIds = idMap(await tx.select({ id: s.brands.id, key: s.brands.slug }).from(s.brands));
    await upsert(
      tx,
      s.productFamilies,
      data.FAMILIES.map((f) => ({
        brandId: need(brandIds, f.brand, "brand"),
        categoryId: need(categoryIds, f.category, "category"),
        slug: f.slug,
        name: f.name,
      })),
      [s.productFamilies.brandId, s.productFamilies.slug],
      ["name", "categoryId"],
    );
    const familyRows = await tx.select().from(s.productFamilies);

    // ── Products ──
    const productRows = data.PRODUCTS.map((p) => {
      const brandId = need(brandIds, p.brand, "brand");
      const v = parseOrThrow(productInputSchema, {
        brandId,
        categoryId: need(categoryIds, p.category, "category"),
        familyId: p.family
          ? familyRows.find((f) => f.brandId === brandId && f.slug === p.family)?.id
          : null,
        name: p.name,
        slug: p.slug,
        modelName: p.name,
        modelNumber: p.modelNumber,
        manufacturerPartNumber: p.mpn ?? null,
        shortDescription: p.short,
        releaseDate: p.releaseDate ?? null,
        announcedDate: p.announcedDate ?? null,
        discontinuedDate: p.discontinuedDate ?? null,
        productStatus: p.status,
        isFeatured: p.featured ?? false,
        isDemo: true,
      });
      return {
        ...v,
        slug: p.slug,
        publicationStatus: "published" as const,
        verificationStatus: p.verification,
        lastVerifiedAt: p.verification === "needs_review" ? null : verifiedAt,
      };
    });
    await upsert(
      tx,
      s.products,
      productRows,
      [s.products.slug],
      [
        "brandId",
        "categoryId",
        "familyId",
        "name",
        "modelName",
        "modelNumber",
        "manufacturerPartNumber",
        "shortDescription",
        "releaseDate",
        "announcedDate",
        "discontinuedDate",
        "productStatus",
        "isFeatured",
        "isDemo",
        "publicationStatus",
        "verificationStatus",
        "lastVerifiedAt",
      ],
    );
    const productIds = idMap(
      await tx
        .select({ id: s.products.id, key: s.products.slug })
        .from(s.products)
        .where(
          inArray(
            s.products.slug,
            data.PRODUCTS.map((p) => p.slug),
          ),
        ),
    );

    // ── Variants ──
    const variantRows = data.PRODUCTS.flatMap((p) =>
      (p.variants ?? []).map((v) => {
        const parsed = parseOrThrow(variantBaseSchema, {
          variantName: v.name,
          variantCode: v.code,
          regionCode: v.region ?? null,
          color: v.color ?? null,
          memoryConfiguration: v.memory ?? null,
          storageConfiguration: v.storage ?? null,
          barcodeGtin: v.gtinBody ? `${v.gtinBody}${gtinCheckDigit(v.gtinBody)}` : null,
          isDefault: v.isDefault ?? false,
        });
        return { ...parsed, variantCode: v.code, productId: need(productIds, p.slug, "product") };
      }),
    );
    // Clear stale defaults first so the one-default partial unique index never trips mid-upsert.
    for (const v of variantRows.filter((r) => r.isDefault)) {
      await tx
        .update(s.productVariants)
        .set({ isDefault: false })
        .where(
          and(
            eq(s.productVariants.productId, v.productId),
            eq(s.productVariants.isDefault, true),
            sql`${s.productVariants.variantCode} <> ${v.variantCode}`,
          ),
        );
    }
    await upsert(
      tx,
      s.productVariants,
      variantRows,
      [s.productVariants.productId, s.productVariants.variantCode],
      [
        "variantName",
        "regionCode",
        "color",
        "memoryConfiguration",
        "storageConfiguration",
        "barcodeGtin",
        "isDefault",
      ],
    );
    const variants = await tx
      .select({
        id: s.productVariants.id,
        productId: s.productVariants.productId,
        code: s.productVariants.variantCode,
      })
      .from(s.productVariants)
      .where(inArray(s.productVariants.productId, [...productIds.values()]));
    const variantId = (productSlug: string, code: string) => {
      const pid = need(productIds, productSlug, "product");
      const v = variants.find((x) => x.productId === pid && x.code === code);
      if (!v) throw new Error(`Seed data error: unknown variant ${productSlug}/${code}`);
      return v.id;
    };

    // ── Specification values (parsed into canonical units by the same code the services use) ──
    const specRows: (typeof s.productSpecifications.$inferInsert)[] = [];
    for (const p of data.PRODUCTS) {
      const defs = defsFor(p.category);
      const productId = need(productIds, p.slug, "product");
      const verified = p.verification === "verified";
      const push = (key: string, raw: data.SeedProduct["specs"][string], vId: string | null) => {
        const def = defs.get(key);
        if (!def) throw new Error(`Seed data error: ${p.slug} has unknown spec "${key}"`);
        specRows.push({
          productId,
          variantId: vId,
          specificationDefinitionId: def.id,
          ...parseSpecificationValue(def, raw),
          sourceId,
          origin: "manual",
          confidence: null,
          verificationStatus: verified ? "verified" : "unverified",
          lastVerifiedAt: verified ? verifiedAt : null,
        });
      };
      for (const [k, raw] of Object.entries(p.specs)) push(k, raw, null);
      for (const v of p.variants ?? []) {
        for (const [k, raw] of Object.entries(v.specs ?? {}))
          push(k, raw, variantId(p.slug, v.code));
      }
    }
    await upsert(
      tx,
      s.productSpecifications,
      specRows,
      [
        s.productSpecifications.productId,
        s.productSpecifications.variantId,
        s.productSpecifications.specificationDefinitionId,
      ],
      [
        "valueText",
        "valueNumeric",
        "valueBoolean",
        "valueDate",
        "valueJson",
        "sourceId",
        "origin",
        "confidence",
        "verificationStatus",
        "lastVerifiedAt",
      ],
    );
    log(
      `products: ${productIds.size}, variants: ${variants.length}, spec values: ${specRows.length}`,
    );

    // ── Provenance records ──
    await tx
      .insert(s.productSourceRecords)
      .values(
        [...productIds.values()].map((productId) => ({
          productId,
          sourceId,
          retrievedAt: verifiedAt,
          notes: "Demonstration data",
        })),
      )
      .onConflictDoNothing();

    // ── Relationships ──
    await upsert(
      tx,
      s.productRelationships,
      data.RELATIONSHIPS.map((r) => ({
        sourceProductId: need(productIds, r.from, "product"),
        targetProductId: need(productIds, r.to, "product"),
        relationshipType: r.type,
        sourceId,
        isVerified: true,
      })),
      [
        s.productRelationships.sourceProductId,
        s.productRelationships.targetProductId,
        s.productRelationships.relationshipType,
      ],
      ["sourceId", "isVerified"],
    );

    // ── Retailers ──
    await upsert(
      tx,
      s.retailers,
      data.RETAILERS.map((r) => ({
        slug: r.slug,
        name: r.name,
        websiteUrl: `https://${r.host}/`,
        allowedRedirectHosts: [r.host],
        countryCode: r.countryCode,
        supportedCurrencies: r.currencies,
        isDemo: true,
      })),
      [s.retailers.slug],
      [
        "name",
        "websiteUrl",
        "allowedRedirectHosts",
        "countryCode",
        "supportedCurrencies",
        "isDemo",
      ],
    );
    const retailerIds = idMap(
      await tx.select({ id: s.retailers.id, key: s.retailers.slug }).from(s.retailers),
    );
    const retailerBySlug = new Map(data.RETAILERS.map((r) => [r.slug, r]));

    // ── Offers + price history ──
    const offerRows = data.OFFERS.map((o) => {
      const r = retailerBySlug.get(o.retailer)!;
      if (!r.currencies.includes(o.currency))
        throw new Error(`Seed data error: ${o.retailer} does not sell in ${o.currency}`);
      return {
        productId: need(productIds, o.product, "product"),
        variantId: o.variant ? variantId(o.product, o.variant) : null,
        retailerId: need(retailerIds, o.retailer, "retailer"),
        retailerProductId: `${o.product}${o.variant ? `-${o.variant}` : ""}`,
        marketCountryCode: o.market,
        productUrl: `https://${r.host}/p/${o.product}${o.variant ? `?v=${o.variant}` : ""}`,
        affiliateUrl: null,
        currency: o.currency,
        priceAmount: Number(o.price).toFixed(4),
        originalPriceAmount: o.originalPrice ? Number(o.originalPrice).toFixed(4) : null,
        shippingCost: o.shipping !== undefined ? Number(o.shipping).toFixed(4) : null,
        availabilityStatus: o.availability,
        condition: o.condition,
        sourceId,
        lastCheckedAt: hoursAgo(o.checkedHoursAgo),
        expiresAt: o.expiresInHours !== undefined ? hoursAgo(-o.expiresInHours) : null,
        isActive: true,
        isDemo: true,
      };
    });
    await upsert(
      tx,
      s.retailerOffers,
      offerRows,
      [
        s.retailerOffers.retailerId,
        s.retailerOffers.productId,
        s.retailerOffers.variantId,
        s.retailerOffers.marketCountryCode,
        s.retailerOffers.condition,
      ],
      [
        "retailerProductId",
        "productUrl",
        "affiliateUrl",
        "currency",
        "priceAmount",
        "originalPriceAmount",
        "shippingCost",
        "availabilityStatus",
        "sourceId",
        "lastCheckedAt",
        "expiresAt",
        "isActive",
        "isDemo",
      ],
    );
    const offers = await tx
      .select()
      .from(s.retailerOffers)
      .where(inArray(s.retailerOffers.productId, [...productIds.values()]));
    for (const o of offers) {
      const [last] = await tx
        .select({ price: s.priceHistory.priceAmount, currency: s.priceHistory.currency })
        .from(s.priceHistory)
        .where(eq(s.priceHistory.offerId, o.id))
        .orderBy(desc(s.priceHistory.recordedAt))
        .limit(1);
      if (!last || Number(last.price) !== Number(o.priceAmount) || last.currency !== o.currency) {
        await tx.insert(s.priceHistory).values({
          offerId: o.id,
          productId: o.productId,
          variantId: o.variantId,
          retailerId: o.retailerId,
          currency: o.currency,
          priceAmount: o.priceAmount,
          recordedAt: o.lastCheckedAt,
          sourceId: o.sourceId,
        });
      }
    }
    log(`retailers: ${retailerIds.size}, offers: ${offers.length}`);

    // ── Guides ──
    await upsert(
      tx,
      s.guides,
      data.GUIDES.map((g) => ({
        slug: g.slug,
        title: g.title,
        summary: g.summary,
        bodyMarkdown: g.body,
        authorName: g.author,
        publicationStatus: "published" as const,
        publishedAt: new Date(g.publishedAt),
        isDemo: true,
      })),
      [s.guides.slug],
      [
        "title",
        "summary",
        "bodyMarkdown",
        "authorName",
        "publicationStatus",
        "publishedAt",
        "isDemo",
      ],
    );
    const guideIds = idMap(await tx.select({ id: s.guides.id, key: s.guides.slug }).from(s.guides));
    const guideProducts = data.GUIDES.flatMap((g) =>
      g.products.map((p) => ({
        guideId: need(guideIds, g.slug, "guide"),
        productId: need(productIds, p, "product"),
      })),
    );
    const guideCategories = data.GUIDES.flatMap((g) =>
      g.categories.map((c) => ({
        guideId: need(guideIds, g.slug, "guide"),
        categoryId: need(categoryIds, c, "category"),
      })),
    );
    if (guideProducts.length)
      await tx.insert(s.guideProducts).values(guideProducts).onConflictDoNothing();
    if (guideCategories.length)
      await tx.insert(s.guideCategories).values(guideCategories).onConflictDoNothing();

    // ── Featured comparisons ──
    await upsert(
      tx,
      s.featuredComparisons,
      data.FEATURED_COMPARISONS.map((f) => ({
        title: f.title,
        productIds: f.products.map((p) => need(productIds, p, "product")),
        sortOrder: f.sortOrder,
        isActive: true,
      })),
      [s.featuredComparisons.title],
      ["productIds", "sortOrder", "isActive"],
    );
    log(`guides: ${guideIds.size}, featured comparisons: ${data.FEATURED_COMPARISONS.length}`);
  });
}

/** Row counts per table — used by the idempotency check. */
export async function countRows(db: Database): Promise<Record<string, number>> {
  const tables = [
    "sources",
    "categories",
    "specification_groups",
    "specification_definitions",
    "brands",
    "product_families",
    "products",
    "product_variants",
    "product_specifications",
    "product_source_records",
    "product_relationships",
    "retailers",
    "retailer_offers",
    "price_history",
    "guides",
    "guide_products",
    "guide_categories",
    "featured_comparisons",
    "audit_logs",
    "review_items",
    "admin_users",
  ];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const [row] = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)}`,
    );
    out[t] = Number(row!.n);
  }
  return out;
}
