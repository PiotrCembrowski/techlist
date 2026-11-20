# Architecture

A modular monolith: one Next.js 16 (App Router) application on Node.js with one PostgreSQL 16
database. No queues, caches or search clusters (rule 2.2.1); every list is paginated or limited.

```
Browser ──► src/proxy.ts (CSP nonce, 301 slug redirects)
              └─► Next.js App Router
                    ├─ src/app/(public)/…   Server Components: catalogue, product, compare, search, guides
                    ├─ src/app/admin/…      Admin pages + Server Actions (adminAction → requireAdmin)
                    ├─ src/app/api/…        Route handlers: Auth.js, search suggestions, compare search, health
                    ├─ src/app/go/[offerId] Affiliate redirect (allow-listed hosts, click logging)
                    ├─ src/app/media/…      Uploaded images from the storage driver
                    └─ sitemap.ts, robots.ts
                         │ pages and route handlers only call services
                         ▼
                    src/modules/<module>/service.ts   business logic, Zod input schemas, audit
                         │ Drizzle (parameterised SQL)
                         ▼
                    PostgreSQL 16 (pg_trgm, unaccent, FTS, triggers, sb_indexable_products)
```

## Layout

| Path               | Contents                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/(public)` | Public pages (route group with the public layout: header, footer, demo banner, compare tray).                                                                                                                                                                                                                                                     |
| `src/app/admin`    | `/admin/login` and the admin shell `(panel)`: dashboard, products, brands, categories, retailers, offers, sources, review queue, import & export, data providers, users, audit log.                                                                                                                                                               |
| `src/modules/*`    | Services: `catalog`, `products`, `variants`, `specifications`, `categories`, `brands`, `search`, `comparisons`, `offers`, `retailers`, `sources`, `catalog-admin` (relationships, images, links, definitions), `imports`, `review-queue`, `corrections`, `providers`, `seo`, `slugs`, `guides`, `media`, `admin-users`, `audit`, `stats`, `home`. |
| `src/lib/*`        | Infrastructure: `db` (pool), `auth` (Auth.js, guard, credentials, argon2), `rate-limit` (Postgres fixed window), `storage` (local/S3 drivers, upload checks), `csv`, `units` (unit registry and conversion), `format`, `market` (cookie), `security` (CSP), `validation`, `admin` (action wrapper, form helpers).                                 |
| `src/db`           | Schema, migrations, seed (`src/db/seed/data.ts` is the only place demo data lives).                                                                                                                                                                                                                                                               |
| `scripts/`         | `db/` (migrate, check), `seed/`, `admin/create.ts`, `perf/bench.ts`.                                                                                                                                                                                                                                                                              |
| `tests/`           | `unit/`, `integration/` (real PostgreSQL), `e2e/` (Playwright, desktop + Pixel 7).                                                                                                                                                                                                                                                                |

## Conventions

- **Services own the rules.** Mutating services take a `ServiceContext` (`{ db, actorId }`), run in
  one transaction (a savepoint when nested) and write an audit log entry in that transaction.
  Inputs are validated with Zod; partial updates use `onlyProvided()` so defaults never overwrite
  stored values; database errors become `ConflictError` / `ValidationError`.
- **Configuration** is read through `getEnv()` (Zod-validated at startup), never `process.env`
  (lint-enforced).
- **Admin authorization** happens server-side in every page (`requireAdmin()`), every Server
  Action (`adminAction()`) and every route handler — an integration test discovers all of them
  and checks anonymous, deactivated and wrong-role access.

## Product and variant model

A **product** is the model (e.g. "Aera 7 Pro"); **variants** are regional or configuration
versions with their own codes, region, GTIN and MPN. Variants are never merged automatically.
Specification **definitions** belong to a category and are inherited by subcategories. Values are
stored once per product, with optional per-variant **overrides**; a variant's effective value is
its override or the product value. Values are typed (text, integer, decimal, boolean, date, enum,
multi-select), parsed into a canonical unit (`src/lib/units`, e.g. "1 TB" → 1000 GB) and carry
source, origin, confidence and verification status. A verified value is never overwritten by
unverified input — a `conflicting_value` review item is created instead.

## Catalogue, filters and comparison

`listCatalog()` serves `/products`, category and brand pages with three queries per page (rows +
count, key specifications, lowest fresh offers). Filters are generated from the category's
filterable definitions and live in the URL. Comparisons (`/compare/a-vs-b[-vs-c[-vs-d]]`, 2–4
products of one top-level category) use canonical, sorted slug order (other orders 301), align
values by definition, mark missing values "Not available" and highlight the best value only when a
definition has a comparison direction.

## Search

`SearchService` (interface) with a PostgreSQL implementation: candidates come from indexes only
— exact model number / MPN / GTIN, full-text search (`search_vector`, `simple` configuration,
unaccented, brand included) and trigram similarity on `search_text` (brand + name) — and are ranked
exact identifier → full-text rank → similarity. Suggestions reuse the same ranking; "did you mean"
uses the trigram index. Search pages are `noindex`. Benchmarks: `docs/PERFORMANCE.md`.

## Offers and affiliate redirects

Offers belong to a retailer, product (optionally variant) and market, with currency, price,
availability, condition and `last_checked_at`. Display rules (`src/modules/offers`): expired,
inactive or inactive-retailer offers are never shown; stale ones (older than `OFFER_STALE_HOURS`)
are shown below fresh ones with a warning and excluded from "lowest price" and structured data; the
selected market comes first. Links go through `/go/[offerId]`: the target is only ever the stored
URL, must be https on a host listed exactly in the retailer's `allowed_redirect_hosts`, the click is
recorded (no IP or user agent) and the response is a 302 with `no-store`. No URL from the request is
ever used as a target.

## Imports and verification

CSV import (`src/modules/imports`): upload → stage raw rows → map columns → **plan** every row with
bulk lookups (references, duplicate detection GTIN → brand+MPN → brand+model number → name
similarity, variant identity, specification scope) → preview → **commit** through the normal
services in batches with one savepoint per row → error report. The plan is recomputed at commit.
Re-importing a file changes nothing (rows are compared with the catalogue). Conflicts and new
products go to the review queue (`src/modules/review-queue`), where editors approve (optionally
after editing) or reject with a note; decisions are remembered for later re-imports. Details:
`docs/DATA_ACQUISITION.md`.

## SEO

`getIndexability()` decides every page's robots rule (mirrored once in SQL for the sitemap);
`pageMetadata()` builds canonical, robots, Open Graph and Twitter metadata; `<JsonLd>` emits
structured data only on indexable pages; `sitemap.ts` lists indexable records only, split at
50,000 URLs. Demo data is never indexed.

## Security

Auth.js credentials login (argon2id, JWT session re-checked against the database on every admin
request), Postgres-backed rate limits (login, corrections, search suggestions, imports), nonce
CSP and security headers from `src/proxy.ts` and `next.config.ts`, upload checks by magic bytes,
CSV formula-injection guard, exact-host redirect allow-list, audit log for every admin change.
Review: `docs/PROGRESS.md` (Stage 7).
