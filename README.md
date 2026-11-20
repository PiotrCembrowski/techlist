# Specbase (working name)

A global technology product database: structured, sourced specifications for phones, laptops,
processors, graphics cards, monitors and headphones; side-by-side comparison of up to four
products; and retailer offers with honest freshness, market and affiliate disclosure.
No ratings, scores or "winners".

> **Status:** Stages 1–5 of 8 are done (foundation, database, public catalogue, comparison, offers).
> Admin, imports, SEO and final docs come in later stages. See [`docs/PROGRESS.md`](docs/PROGRESS.md).

- Specification (source of truth): [`docs/SPEC.md`](docs/SPEC.md)
- Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Design direction: **1a "Drafting Sheet"** from the Claude Design handoff in [`design/`](design/README.md)

## Stack

Next.js 16 (App Router, React Server Components) · TypeScript (strict) · Tailwind CSS 4 + shadcn/ui
conventions · Lucide icons · PostgreSQL 16 (`pg_trgm`, `unaccent`) · Drizzle ORM + Drizzle Kit ·
Zod 4 · Vitest · Playwright · pnpm.

## Prerequisites

- Node.js 22 LTS or newer, pnpm 10 (`corepack enable`)
- PostgreSQL 16 or newer — via Docker (`docker compose`) or a local install
- For e2e tests: Playwright's Chromium (`pnpm exec playwright install chromium`)

## Getting started

```bash
pnpm install
cp .env.example .env          # adjust if your database differs
pnpm db:up                    # PostgreSQL 16 in Docker (creates specbase + specbase_test)
pnpm db:check                 # confirms version and extensions
pnpm db:migrate               # apply migrations
pnpm db:seed                  # fictional demo data (idempotent: safe to run again)
pnpm dev                      # http://localhost:3000
```

**Without Docker:** create a role and two databases yourself. Migrations install `pg_trgm` and `unaccent`;
both are trusted extensions, so the database owner can create them:

```sql
CREATE ROLE specbase LOGIN PASSWORD 'specbase';
CREATE DATABASE specbase OWNER specbase;
CREATE DATABASE specbase_test OWNER specbase;
```

## Environment variables

Validated with Zod at startup (`src/config/env.ts`); see `.env.example`.

| Variable                                                        | Required       | Default                 | Purpose                                                                        |
| --------------------------------------------------------------- | -------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                  | yes            | —                       | PostgreSQL connection string                                                   |
| `TEST_DATABASE_URL`                                             | for tests      | —                       | Separate database. **Its schema is dropped** by integration/e2e setup          |
| `SITE_URL`                                                      | in deployments | `http://localhost:3000` | Canonical origin for metadata                                                  |
| `ENABLE_DEMO_DATA`                                              | no             | `false`                 | Shows the site-wide demo banner; demo offers may redirect                      |
| `ALLOW_DEMO_SEED`                                               | no             | `false`                 | Required to seed demo data with `NODE_ENV=production`                          |
| `SUSPICIOUS_PRICE_DEVIATION`                                    | no             | `0.5`                   | Offer prices further than this from the median create a review item            |
| `OFFER_STALE_HOURS`                                             | no             | `72`                    | Offers last checked longer ago are shown as stale                              |
| `DB_POOL_MAX`                                                   | no             | `10`                    | Connection pool size                                                           |
| `AUTH_SECRET`                                                   | **yes**        | —                       | Auth.js secret, ≥ 32 chars (`openssl rand -base64 32`). Never commit           |
| `STORAGE_DRIVER`                                                | no             | `local`                 | `local` or `s3` (any S3-compatible service) for uploaded images                |
| `STORAGE_LOCAL_DIR`                                             | no             | `storage/uploads`       | Upload directory for the local driver (git-ignored)                            |
| `S3_BUCKET` / `S3_REGION`                                       | with `s3`      | —                       | Bucket and region; `S3_ENDPOINT` for R2/MinIO                                  |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`                     | no             | —                       | Omit to use the SDK's default credential chain                                 |
| `TRUSTED_PROXY_HOPS`                                            | no             | `1`                     | Reverse proxies that append to `X-Forwarded-For` (rate limits); `0` ignores it |
| `MANUFACTURER_FILES_DIR`, `LICENSED_FEED_*`, `AFFILIATE_FEED_*` | no             | —                       | Data provider adapters; unset = "Not configured" (`docs/DATA_SOURCES.md`)      |

## Database

- Schema: `src/db/schema/*.ts` (Drizzle). Migrations: `src/db/migrations/`.
- `0000_extensions.sql` and `0002_triggers.sql` are hand-written (extensions, an immutable
  `sb_unaccent()` for indexes, `updated_at` triggers, the product search-vector trigger);
  `0001_schema.sql` is generated by Drizzle Kit.
- After changing the schema: `pnpm db:generate`, review the SQL, then `pnpm db:migrate`.
- `pnpm db:migrate:fresh` drops and re-creates the schema (refused when `NODE_ENV=production`).

## Demo data

`pnpm db:seed` loads fictional brands (Halden, Novik, Corvala, Quillon), 22 products across six
categories (plus a "Gaming laptops" subcategory that inherits laptop specifications), variants,
4 demo retailers on `.example` domains, offers in PLN/EUR/USD (fresh, stale, out-of-stock,
refurbished, expired), 2 guides and 2 featured comparisons. Every record has `is_demo = true`.
Running it again changes nothing. It never creates admin users.

## Creating the first admin

```bash
pnpm admin:create --email you@example.com --name "Your Name"
```

You are asked for the password twice (hidden input, at least 12 characters); it can also be piped
on stdin. The first account is always an `owner`; later ones default to `editor`
(`--role owner` to override). There is no default password and no public registration. Owners
manage further users at `/admin/users`.

## Admin

Sign in at `/admin/login`. Editors manage products, variants, specifications, images, brands,
categories and specification definitions, retailers, offers and sources. Owners also manage
users. Every change is written to the audit log (`/admin/audit`) in the same transaction.
Sign-in is limited to 5 attempts per 15 minutes per address and email.

- **Import & export** (`/admin/imports`): upload a products or offers CSV (≤ 5 MB, ≤ 10,000
  rows, UTF-8), check the column mapping, preview what each row would do (create / update / skip /
  conflict / error), commit, and download an error report. Duplicates are detected by GTIN, brand +
  MPN, brand + model number, then name similarity (never merged automatically). Re-importing a
  file changes nothing. Exports use the same format. Try `docs/samples/products-import-sample.csv`.
- **Review queue** (`/admin/review`): conflicting and unverified values, possible duplicates,
  variant ambiguity, new imported products, reader corrections and suspicious prices. Approve
  (optionally after editing), or reject with a note; every decision is audited.
- **Data providers** (`/admin/data-sources`): which adapters are configured (`docs/DATA_SOURCES.md`).

Readers can suggest corrections from any product page (no account; rate limited; honeypot).

## Tests

```bash
pnpm typecheck && pnpm lint
pnpm test:unit               # pure logic: units, validation, spec parsing
pnpm test:integration        # real PostgreSQL via TEST_DATABASE_URL (schema is reset first)
pnpm e2e                     # builds, resets + seeds the test DB, runs desktop + mobile (incl. axe)
PERF_DATABASE_URL=postgres://…/specbase_perf pnpm perf:bench   # 20,000-product benchmark (docs/PERFORMANCE.md)
```

## Deployment (summary)

Vercel-compatible Next.js app with a managed PostgreSQL 16 database. Set the environment variables
above (`SITE_URL` must be the public origin), run `pnpm db:migrate` as a release step, and never
run the demo seed against production data. Full guide: `docs/DEPLOYMENT.md` (Stage 8).
