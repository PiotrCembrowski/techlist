import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { createBrand } from "@/modules/brands/service";
import { createCategory } from "@/modules/categories/service";
import type { ServiceContext } from "@/modules/_shared/context";
import { createProduct } from "@/modules/products/service";
import {
  createSpecificationDefinition,
  createSpecificationGroup,
} from "@/modules/specifications/service";

export const db = () => getDb();
export const ctx = (): ServiceContext => ({ db: getDb(), actorId: null });

/** Empty every application table (keeps the migrated schema). */
export async function truncateAll() {
  const rows = await getDb().execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (list) await getDb().execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function makeBrand(name = `Testbrand ${uniq()}`) {
  return createBrand(ctx(), { name });
}

export async function makeCategory(name = `Testcat ${uniq()}`, parentId: string | null = null) {
  return createCategory(ctx(), { name, parentId });
}

/** A laptop-like category with a few typed definitions. */
export async function makeSpecCategory(parentId: string | null = null) {
  const category = await makeCategory(undefined, parentId);
  const group = await createSpecificationGroup(ctx(), {
    categoryId: category.id,
    key: "main",
    name: "Main",
  });
  const def = (key: string, extra: Record<string, unknown>) =>
    createSpecificationDefinition(ctx(), {
      categoryId: category.id,
      groupId: group.id,
      key,
      name: key,
      ...extra,
    } as never);
  const defs = {
    storage: await def("storage", {
      dataType: "integer",
      canonicalUnit: "GB",
      validationRules: { min: 16, max: 16000 },
    }),
    weight: await def("weight", {
      dataType: "decimal",
      canonicalUnit: "kg",
      validationRules: { min: 0.3, max: 6 },
    }),
    screen: await def("screen_size", { dataType: "decimal", canonicalUnit: "in" }),
    panel: await def("panel", { dataType: "enum", validationRules: { options: ["IPS", "OLED"] } }),
    ports: await def("ports", {
      dataType: "multi_select",
      validationRules: { options: ["USB-C", "HDMI", "Audio"] },
    }),
    backlit: await def("backlit", { dataType: "boolean" }),
    note: await def("note", { dataType: "text", validationRules: { maxLength: 10 } }),
    launch: await def("launch", { dataType: "date" }),
  };
  return { category, group, defs };
}

export async function makeProduct(
  overrides: {
    brandId?: string;
    categoryId?: string;
    name?: string;
    modelNumber?: string | null;
  } = {},
) {
  const brandId = overrides.brandId ?? (await makeBrand()).id;
  const categoryId = overrides.categoryId ?? (await makeCategory()).id;
  return createProduct(ctx(), {
    brandId,
    categoryId,
    name: overrides.name ?? `Product ${uniq()}`,
    modelNumber: overrides.modelNumber === undefined ? `MN-${uniq()}` : overrides.modelNumber,
  });
}
