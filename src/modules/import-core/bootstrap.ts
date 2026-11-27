import { and, eq, inArray } from "drizzle-orm";
import { categories, specificationDefinitions, specificationGroups } from "@/db/schema";
import { getCategoryAncestors, getCategoryDescendantIds } from "@/modules/categories/service";
import { createCategory } from "@/modules/categories/service";
import { inTransaction, type ServiceContext } from "@/modules/_shared/context";
import {
  createSpecificationDefinition,
  createSpecificationGroup,
} from "@/modules/specifications/service";
import { TARGET_CATEGORIES, type CategoryConfig, type DefinitionConfig } from "./catalog-config";

export interface BootstrapCategoryReport {
  slug: string;
  categoryCreated: boolean;
  groupsCreated: string[];
  definitionsCreated: string[];
  /** Existing definitions that differ from the configuration; never changed automatically. */
  conflicts: { key: string; reason: string }[];
}

class DryRun extends Error {}

function differences(
  existing: typeof specificationDefinitions.$inferSelect,
  want: DefinitionConfig,
): string[] {
  const out: string[] = [];
  if (existing.dataType !== want.dataType)
    out.push(`type is ${existing.dataType}, configuration says ${want.dataType}`);
  if ((existing.canonicalUnit ?? null) !== (want.unit ?? null))
    out.push(
      `unit is ${existing.canonicalUnit ?? "none"}, configuration says ${want.unit ?? "none"}`,
    );
  const haveOptions = (existing.validationRules as { options?: string[] }).options;
  const wantOptions = want.rules?.options;
  if (wantOptions && JSON.stringify(haveOptions ?? []) !== JSON.stringify(wantOptions))
    out.push(`options differ (${(haveOptions ?? []).join(", ") || "none"})`);
  return out;
}

async function bootstrapCategory(
  ctx: ServiceContext,
  config: CategoryConfig,
): Promise<BootstrapCategoryReport> {
  const report: BootstrapCategoryReport = {
    slug: config.slug,
    categoryCreated: false,
    groupsCreated: [],
    definitionsCreated: [],
    conflicts: [],
  };
  const tx = ctx.db;
  let [category] = await tx.select().from(categories).where(eq(categories.slug, config.slug));
  if (!category) {
    category = await createCategory(ctx, {
      name: config.name,
      slug: config.slug,
      description: config.description,
      icon: config.icon,
      sortOrder: config.sortOrder,
      parentId: null,
    });
    report.categoryCreated = true;
  }

  const groups = new Map(
    (
      await tx
        .select()
        .from(specificationGroups)
        .where(eq(specificationGroups.categoryId, category.id))
    ).map((g) => [g.key, g.id]),
  );
  for (const g of config.groups) {
    if (groups.has(g.key)) continue;
    const created = await createSpecificationGroup(ctx, {
      categoryId: category.id,
      key: g.key,
      name: g.name,
      displayOrder: g.order,
    });
    groups.set(g.key, created.id);
    report.groupsCreated.push(g.key);
  }

  // Keys already used anywhere in the category's inheritance chain (ancestors and subcategories).
  const chain = [
    ...(await getCategoryAncestors(tx, category.id)).map((a) => a.id),
    ...(await getCategoryDescendantIds(tx, category.id)),
  ];
  const existing = await tx
    .select()
    .from(specificationDefinitions)
    .where(
      and(
        inArray(specificationDefinitions.categoryId, chain),
        inArray(
          specificationDefinitions.key,
          config.definitions.map((d) => d.key),
        ),
      ),
    );
  for (const [i, d] of config.definitions.entries()) {
    const found = existing.find((e) => e.key === d.key);
    if (found) {
      if (found.categoryId !== category.id) {
        report.conflicts.push({ key: d.key, reason: "already defined in a related category" });
        continue;
      }
      for (const reason of differences(found, d)) report.conflicts.push({ key: d.key, reason });
      continue;
    }
    await createSpecificationDefinition(ctx, {
      categoryId: category.id,
      groupId: groups.get(d.group) ?? null,
      key: d.key,
      name: d.name,
      dataType: d.dataType,
      canonicalUnit: d.unit ?? null,
      displayOrder: (i + 1) * 10,
      isFilterable: d.filterable ?? false,
      isRequired: d.required ?? false,
      comparisonDirection: d.direction ?? "none",
      validationRules: d.rules ?? {},
    });
    report.definitionsCreated.push(d.key);
  }
  return report;
}

/**
 * Creates the target categories, groups and specification definitions that do not exist yet
 * (idempotent, audited through the normal services). Existing definitions are never modified;
 * differences are reported. `dryRun` reports what would happen and rolls everything back.
 */
export async function bootstrapCatalog(
  ctx: ServiceContext,
  opts: { dryRun?: boolean; configs?: CategoryConfig[] } = {},
): Promise<BootstrapCategoryReport[]> {
  const reports: BootstrapCategoryReport[] = [];
  try {
    await inTransaction(ctx, async (tx) => {
      for (const config of opts.configs ?? TARGET_CATEGORIES)
        reports.push(await bootstrapCategory({ db: tx, actorId: ctx.actorId }, config));
      if (opts.dryRun) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return reports;
}
