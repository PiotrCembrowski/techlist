# Identity, duplicates and provenance

How an imported record becomes catalogue data (`src/modules/import-core`, DECISIONS D79). Nothing
here publishes anything: imports create or update `needs_review` records, and every uncertain
decision goes to the review queue.

## 1. Normalisation (`normalize.ts`, `identity.ts`, `src/lib/gtin.ts`)

Each provider record becomes a `NormalizedProduct`. Every normalised value keeps the provider's
original next to it; values the provider did not give stay empty — nothing is inferred.

| Field          | Rule                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| GTIN           | GTIN-8, UPC-A, EAN-13, GTIN-14 with valid check digit → GTIN-14. Invalid ones are listed, not dropped.              |
| MPN            | Upper case, whitespace removed, dash variants unified. Punctuation kept.                                            |
| Model number   | Compared by letters and digits only (`SM-S928B` = `sm s928b`).                                                      |
| Brand          | Accents/case folded, corporate suffixes removed (`Co., Ltd.`, `Inc`, …).                                            |
| Name           | Trimmed, trademark signs removed; the brand prefix is dropped for display (pages add the brand).                    |
| Release date   | Only full dates (`YYYY-MM-DD`). A year or a month alone is not turned into a date.                                  |
| Description    | Plain text (HTML removed), max 5,000 characters.                                                                    |
| Specifications | Through `provider_mappings` (by provider feature ID, then by `name:<feature name>`), parsed against the definition. |
| Images         | https only; stored as remote references with author and licence, `needs_review`.                                    |

Specification values are converted only when the unit is unambiguous: `1 TB` → 1000 GB and
`15.6 cm` → 6.14 in are converted; a bare `256` for a GB field is rejected unless the mapping states
the unit (`transform.unit`, set only when the provider documents it). Values outside the
definition's range or not in its option list are rejected and reported. Features without a
mapping are kept on the source record (`unmapped_features`) and listed by
`unmappedFeatureReport()` per category, so mappings can be added later.

## 2. Categories and definitions (`catalog-config.ts`, `pnpm catalog:bootstrap`)

Smartphones, laptops, CPUs, GPUs, monitors and headphones, with the specification sets from the
import brief. `pnpm catalog:bootstrap [--dry-run]` creates missing categories, groups and
definitions through the normal (audited) services. It never changes an existing definition; it
prints differences instead. Adding a category = a new entry plus provider mappings.

Storage and RAM define variants for smartphones and laptops: two storage configurations are two
variants of one product, never two products and never one variant.

## 3. Matching (`match.ts`)

Brand first: a provider brand mapping, else our brand names and aliases by brand key. Unknown or
ambiguous brands block the record (create the brand or add a mapping); brands are never created
automatically. Records whose category has no mapping are blocked the same way.

Then, in order:

| Step | Rule                                 | Result                                                                                |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| 0    | Same provider + provider product ID  | Same record as before                                                                 |
| 1    | Exact GTIN                           | Match — unless the matched variant's storage/memory/colour/region differ: then review |
| 2    | Exact MPN + brand                    | Match                                                                                 |
| 3    | Exact model number + brand           | Match                                                                                 |
| 4    | Same normalised name + brand         | **Suggestion only** (confidence 0.9) → duplicate review                               |
| 5    | Similar name (trigram ≥ 0.6) + brand | **Suggestion only** (confidence = 0.8 × similarity) → duplicate review                |

If identifiers point to different products or different variants, the record goes to review with
all candidates. Nothing is ever merged on a similar name.

**Variant of a matched product:** reused only on the same GTIN or MPN, or when exactly one variant
has the same configuration. Several possible variants → `variant_ambiguity` review; a new
configuration → a new `needs_review` variant.

## 4. Applying (`apply.ts`) — safe upserts

One transaction per record, serialised per provider record with an advisory lock; unique
constraints (provider + provider ID, GTIN) catch anything else, so retries cannot create
duplicates. A record whose payload hash has not changed only updates `last_seen_at`.

For each field the provider supplies (`provenance.ts`, `decideField`):

| Our value                                                                                 | Provider's different value                                                    |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Empty                                                                                     | Written                                                                       |
| Supplied earlier by the same source, product not verified/published                       | Written (the source updated it)                                               |
| Entered or edited by an admin, verified, product verified/published, or of unknown origin | **Review item** (`field_conflict`, or `conflicting_value` for specifications) |
| From another source with higher confidence                                                | Kept; the provider's value is recorded as non-current provenance              |
| From another source with equal or lower confidence                                        | **Review item**                                                               |

A provider never clears a value it does not have, never changes a product's status, and never
marks anything verified. Admin edits through the product and variant services are recorded as
manual provenance automatically.

Every applied value gets a `field_provenance` row (source, provider ID, raw value, value hash,
confidence, retrieval time; or the admin for manual values). One audit entry per import summarises
the provider, the record, the outcome and every field decision; the services add their own
before/after audit entries.

## 5. Review decisions

| Item                             | Choices                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `duplicate_candidate` (provider) | Same product (merge) · a variant of it · a different product (keep separate) · do not import |
| `variant_ambiguity` (provider)   | One of the listed variants · a new variant · do not import                                   |
| `field_conflict`                 | Apply the provider value (optionally edited) · keep ours                                     |
| `conflicting_value`              | Apply the provider value (becomes verified) · keep ours                                      |
| `image_rights`                   | Rights confirmed (image may show) · do not use                                               |
| `new_product`                    | Verify and publish · reject                                                                  |

Reviewer decisions re-run the import with that decision, through the same rules.
