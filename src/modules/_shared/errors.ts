import { type ZodError } from "zod";

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "validation" | "conflict" | "forbidden" | "invalid_state",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string, ref: string) {
    super(`${entity} not found: ${ref}`, "not_found", { entity, ref });
  }
}

export class ValidationError extends ServiceError {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message, "validation", issues);
  }

  static fromZod(err: ZodError, prefix = "Invalid input") {
    const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return new ValidationError(
      `${prefix}: ${issues.map((i) => `${i.path || "(root)"} ${i.message}`).join("; ")}`,
      issues,
    );
  }
}

export class ConflictError extends ServiceError {
  constructor(
    message: string,
    readonly constraint?: string,
  ) {
    super(message, "conflict", { constraint });
  }
}

export class InvalidStateError extends ServiceError {
  constructor(message: string) {
    super(message, "invalid_state");
  }
}

interface PgErrorLike {
  code?: string;
  constraint_name?: string;
  constraint?: string;
  message?: string;
}

/** Find the underlying Postgres error (Drizzle wraps driver errors in `cause`). */
export function pgError(err: unknown): PgErrorLike | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (
      typeof cur === "object" &&
      cur !== null &&
      "code" in cur &&
      typeof (cur as PgErrorLike).code === "string"
    ) {
      const code = (cur as PgErrorLike).code!;
      if (/^[0-9A-Z]{5}$/.test(code)) return cur as PgErrorLike;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  brands_slug_unique: "A brand with this slug already exists",
  brands_name_normalized_uq: "A brand with this name already exists (case and accents are ignored)",
  categories_slug_unique: "A category with this slug already exists",
  products_slug_unique: "A product with this slug already exists",
  products_brand_model_number_uq: "This brand already has a product with this model number",
  product_variants_gtin_uq: "Another variant already uses this GTIN",
  product_variants_product_code_uq: "This product already has a variant with this code",
  product_variants_one_default_uq: "A product can only have one default variant",
  product_specifications_value_uq:
    "This specification already has a value for this product/variant",
  specification_definitions_category_key_uq:
    "A definition with this key already exists in the category",
  specification_groups_category_key_uq: "A group with this key already exists in the category",
  product_families_brand_slug_uq: "This brand already has a family with this slug",
  sources_name_uq: "A source with this name already exists",
};

/** Translate constraint violations into typed service errors; rethrow anything else. */
export function rethrowDbError(err: unknown): never {
  const pg = pgError(err);
  if (pg?.code === "23505") {
    const c = pg.constraint_name ?? pg.constraint;
    throw new ConflictError(
      CONSTRAINT_MESSAGES[c ?? ""] ?? `Duplicate value (${c ?? "unique constraint"})`,
      c,
    );
  }
  if (pg?.code === "23514") {
    const c = pg.constraint_name ?? pg.constraint;
    throw new ValidationError(`Value rejected by database rule ${c ?? ""}`.trim());
  }
  if (pg?.code === "23503") {
    throw new ValidationError(
      `Referenced record does not exist or is still in use (${pg.constraint_name ?? ""})`,
    );
  }
  throw err;
}

export function parseOrThrow<T>(
  schema: {
    safeParse(v: unknown): { success: true; data: T } | { success: false; error: ZodError };
  },
  value: unknown,
  prefix?: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw ValidationError.fromZod(r.error, prefix);
  return r.data;
}
