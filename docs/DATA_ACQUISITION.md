# Data acquisition

How data gets into the catalogue, how its origin is recorded, and how it becomes "verified".

## Data rights and provenance

- Every piece of data comes from a **source** (`sources`): type, URL, provider, licence, access
  method, whether attribution is required and whether **usage is permitted**. Unknown rights mean
  "not permitted" (the default).
- Nothing is imported, attached as a source record or shown publicly (images, manufacturer links)
  from a source whose usage is not permitted (rule 2.1.9).
- No scrapers, no bypassing of access controls, no network requests without configured credentials
  and an agreement (rule 2.1.10). Manufacturer and retailer images are never assumed to be
  redistributable: images are uploaded files with a recorded licence, and hotlinking is impossible.
- Each specification value stores its source, origin (`manual`, `import`, `ai_extracted`),
  confidence and verification status. Product pages list their sources with retrieval dates and
  show "unverified" values as such.
- Source hierarchy (SPEC §10): manufacturer documentation → licensed providers → approved affiliate
  feeds/APIs → retailer feeds → manual research → AI-assisted extraction → community corrections
  (reviewed).

## CSV import (Admin → Import & export)

1. **Template** — products (one row per variant): `brand, category_slug, product_name,
model_number, mpn, product_status, release_date, variant_name, variant_code, region_code, color,
memory, storage, gtin, source_name, source_url, is_demo` plus `spec.<key>` per specification of
   the chosen category. Offers: `retailer_slug, brand, product_model_number, gtin, variant_code,
market_country_code, currency, price, original_price, shipping_cost, condition, availability,
product_url, affiliate_url, last_checked_at, expires_at, is_demo`. (`is_demo`, and `brand` on
   offers, are additions to the SPEC list; D59.)
2. **Upload** — `.csv`, UTF-8, ≤ 5 MB, ≤ 10,000 rows, unique headers; the import's source must
   permit use; 20 uploads per admin per hour. Rows are stored raw in `import_rows`.
3. **Map columns** — automatic by header name (case/space/dash-insensitive, common aliases such as
   EAN/UPC → `gtin`); every column can be re-mapped or ignored.
4. **Validate** — Zod per row (types, dates, GTIN check digit, region codes, enums), then bulk
   resolution of brands, categories, sources, products and variants, and unit parsing of every
   specification value (`"1 TB"` → 1000 GB).
5. **Preview** — each row is `create`, `update`, `skip` (nothing would change), `conflict` (needs a
   human) or `error` (with field-level messages), filterable by action.
6. **Duplicate detection**, in this order: exact GTIN → brand + MPN (product or variant) → brand +
   normalised model number (case and punctuation ignored) → product-name trigram similarity ≥ 0.6
   within the brand. The first three are matches; similarity alone becomes a
   `duplicate_candidate` review item and is never merged automatically. A matched variant whose
   region differs from the row's becomes `variant_ambiguity` (regional variants are never merged).
7. **Errors per row** are shown in the preview and in the downloadable error report.
8. **Commit** — the plan is recomputed, then valid rows are applied through the normal services in
   transactions of 100 rows, one savepoint per row (a failing row is reported, the others still
   apply). New products are created as drafts and queued as `new_product` review items. Imported
   values are `unverified`; a row that would change a **verified** value creates a
   `conflicting_value` review item instead.
9. **Results** — counts per outcome; the job keeps every row's final action.
10. **Error report** — CSV of failed and conflicting rows with the original cells and the reasons.

**Idempotency.** A row is skipped when applying it would change nothing (fields, the variant's
effective specification values and the source record all match). Empty cells never clear stored
values. Re-importing the same file therefore creates zero records; exporting and re-importing is a
no-op. Proposals already waiting in the review queue are not queued twice, and earlier review
decisions about the same row (matched by `row_hash`) are followed.

**Where values go.** If every variant of a product gets the same value from the file, it is stored
once at product level; otherwise each variant gets its own override (D58).

**Exports** use the same columns (one row per variant with effective values and units), so files
round-trip. Cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to stop
spreadsheet formula injection; the importer removes the prefix again.

**Large files.** See `docs/PERFORMANCE.md` for timings at the 10,000-row limit.

`docs/samples/products-import-sample.csv` is a small fictional file (demo brand, `is_demo=true`)
with two valid rows, two invalid rows and a likely duplicate.

## Verification workflow

- **Products** have a verification status (`draft → needs_review → partially_verified / verified`,
  or `rejected`) set by editors; only verified or partially verified products can be indexed.
- **Values** are `unverified` until a human verifies them: in the specification editor ("I checked
  these against the source"), or by approving a review item. Verified values require a
  verification timestamp (database check).
- **Review queue** (Admin → Review queue): approve, edit-then-approve, or reject with a note; each
  decision is applied in one transaction and audited.

| Item                  | Created by                                                                                      | Approve                                                                                               | Reject                  |
| --------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- |
| `conflicting_value`   | Unverified input for a verified value (editor, import)                                          | Apply the proposed or edited value as verified                                                        | Keep the verified value |
| `unverified_spec`     | AI-extracted value                                                                              | Verify (optionally edited)                                                                            | Delete the value        |
| `new_product`         | Import created a draft product                                                                  | Publish                                                                                               | Archive                 |
| `duplicate_candidate` | Import row similar to an existing product                                                       | "Same product" updates it, or "different product" creates it                                          | Discard the row         |
| `variant_ambiguity`   | Import row matches a variant of another region, or identifiers disagree                         | "Same variant" updates it, or "separate variant" creates it                                           | Discard the row         |
| `correction`          | Public "Suggest a correction" form                                                              | Apply the value (source "Reader corrections (reviewed)"; replacing a verified value needs "verified") | Nothing changes         |
| `suspicious_price`    | Offer price more than 50 % from the median of the product's other fresh offers in that currency | Price confirmed                                                                                       | Offer deactivated       |

## Provider adapters (`src/modules/providers`)

All sources implement `ProductDataProvider`:

```ts
interface ProductDataProvider {
  readonly name: string;
  readonly sourceId: string;
  isConfigured(): boolean;
  fetchProducts(options?: { since?: Date; limit?: number }): Promise<unknown[]>;
  normalizeProduct(raw: unknown): Promise<NormalizedProduct>; // validated by Zod
}
```

| Adapter                     | Status                                         | Settings                                       |
| --------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `CsvProductProvider`        | Implemented (the import uses the same parsing) | none                                           |
| `ManufacturerFilesProvider` | Stub                                           | `MANUFACTURER_FILES_DIR`                       |
| `LicensedFeedProvider`      | Stub                                           | `LICENSED_FEED_URL`, `LICENSED_FEED_API_KEY`   |
| `AffiliateFeedProvider`     | Stub                                           | `AFFILIATE_FEED_URL`, `AFFILIATE_FEED_API_KEY` |

The stubs show **Not configured** on Admin → Data providers until their settings exist; even then
they refuse to fetch, because no provider is contracted or implemented. To add one:

1. Get a written agreement that permits storing and publishing the data (and images, if any).
2. Create a `sources` row with the licence details and **usage permitted** ticked.
3. Put the credentials in the environment (never in the repository) and in `src/config/env.ts`.
4. Implement `fetchProducts` (respecting the provider's terms and rate limits) and
   `normalizeProduct` (map to `NormalizedProduct`; the CSV adapter shows the shape).
5. Feed normalised products through the import pipeline so duplicate detection, verified-value
   protection and the review queue apply.

## AI-assisted extraction

Not integrated. The hook exists: `setSpecificationValue({ origin: "ai_extracted", confidence })`
always stores the value as **unverified** and creates an `unverified_spec` review item
(rule 2.1.8).

## Reader corrections

"Suggest a correction" on every product page: optional specification, value, source URL, optional
email; honeypot field; 5 submissions per address per hour; only published products. Creates a
`correction` review item; the email is removed when the item is resolved.
