"use server";

import { redirect } from "next/navigation";
import { adminAction, bool, int, list, req, str } from "@/lib/admin/action";
import { updateSpecificationDefinition } from "@/modules/catalog-admin/service";
import { createCategory, updateCategory } from "@/modules/categories/service";
import {
  createSpecificationDefinition,
  createSpecificationGroup,
} from "@/modules/specifications/service";

function fields(fd: FormData) {
  return {
    name: req(fd, "name"),
    slug: str(fd, "slug") ?? undefined,
    parentId: str(fd, "parentId"),
    description: str(fd, "description"),
    icon: str(fd, "icon"),
    sortOrder: int(fd, "sortOrder"),
    seoTitle: str(fd, "seoTitle"),
    seoDescription: str(fd, "seoDescription"),
    isActive: !bool(fd, "inactive"),
  };
}

export const createCategoryAction = adminAction(async ({ ctx }, fd) => {
  const c = await createCategory(ctx, fields(fd));
  redirect(`/admin/categories/${c.id}?created=1`);
});

export const updateCategoryAction = adminAction(async ({ ctx }, fd) => {
  const f = fields(fd);
  if (!f.slug) delete f.slug;
  await updateCategory(ctx, req(fd, "id"), f);
  return "Category saved";
});

export const createGroupAction = adminAction(async ({ ctx }, fd) => {
  await createSpecificationGroup(ctx, {
    categoryId: req(fd, "categoryId"),
    key: req(fd, "key"),
    name: req(fd, "name"),
    displayOrder: int(fd, "displayOrder"),
  });
  return "Group added";
});

/** Validation rules from simple fields; options one per line or comma-separated. */
function rules(fd: FormData) {
  const r: Record<string, unknown> = {};
  for (const k of ["min", "max", "step"] as const) {
    const v = str(fd, k);
    if (v !== null) r[k] = Number(v.replace(",", "."));
  }
  const maxLength = str(fd, "maxLength");
  if (maxLength) r.maxLength = Number(maxLength);
  const options = list(fd, "options");
  if (options.length) r.options = options;
  return r;
}

function definitionFields(fd: FormData) {
  return {
    name: req(fd, "name"),
    description: str(fd, "description"),
    groupId: str(fd, "groupId"),
    dataType: req(fd, "dataType") as "text",
    canonicalUnit: str(fd, "canonicalUnit"),
    displayOrder: int(fd, "displayOrder"),
    isFilterable: bool(fd, "isFilterable"),
    isComparable: bool(fd, "isComparable"),
    isRequired: bool(fd, "isRequired"),
    isPublic: !bool(fd, "hidden"),
    comparisonDirection: (str(fd, "comparisonDirection") ?? "none") as "none",
    validationRules: rules(fd),
  };
}

export const createDefinitionAction = adminAction(async ({ ctx }, fd) => {
  await createSpecificationDefinition(ctx, {
    ...definitionFields(fd),
    categoryId: req(fd, "categoryId"),
    key: req(fd, "key"),
  });
  return "Specification added";
});

export const updateDefinitionAction = adminAction(async ({ ctx }, fd) => {
  await updateSpecificationDefinition(ctx, req(fd, "id"), definitionFields(fd));
  return "Specification saved";
});
