# Progress

## Implementation plan

| Stage                     | Scope                                                                                                                                                                                                                                                                                             | Status   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1 Foundation              | Next.js 16 + strict TS, Tailwind 4 + shadcn conventions, 1a design tokens, ESLint/Prettier, Zod env, Docker Compose, Drizzle, Vitest + Playwright, app shell, `.env.example`, README                                                                                                              | **Done** |
| 2 Database                | Full schema + migrations, unit registry, services for brands/categories/products/variants/specifications, integration tests, idempotent seed                                                                                                                                                      | **Done** |
| 3 Public catalog          | Header nav + market selector (cookie), homepage sections, `/products`, `/categories/[slug]` with filters generated from definitions, brand pages, PDP with variants and grouped spec table, search (`SearchService`: exact model/MPN/GTIN → FTS → trigram) + suggestions, static pages. Journey A | Next     |
| 4 Comparison              | Tray (localStorage), picker, `compareProducts()`, canonical `-vs-` URLs (301), responsive table. Journey B                                                                                                                                                                                        | —        |
| 5 Offers & affiliate      | Fresh/stale/expired rules, market grouping, `/go/[offerId]` with host allowlist, clicks, price-history writes. Journey C                                                                                                                                                                          | —        |
| 6A Admin core             | Auth.js credentials + argon2id, `admin:create`, Postgres rate limiter, role checks in every action, CRUD, audit log. Journey D                                                                                                                                                                    | —        |
| 6B Imports & verification | CSV stage/validate/preview/commit, duplicate detection, error report, export with formula-injection guard, review queue, correction form. Journey E                                                                                                                                               | —        |
| 7 SEO & quality           | Metadata, JSON-LD, indexability function, sitemap/robots, slug 301s, axe, security headers/CSP                                                                                                                                                                                                    | —        |
| 8 Final                   | Full suite, mobile e2e, all docs, acceptance checklist                                                                                                                                                                                                                                            | —        |

Order of work inside each stage: schema/service → tests → UI → e2e journey → gate.

---

## Stage 1 + 2 — gate run 2026-11-19

### Done and verified

All checks below were run in this session and seen passing.

| Check                                                          | Command                 | Result                                                                                                              |
| -------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Typecheck                                                      | `pnpm typecheck`        | pass                                                                                                                |
| Lint                                                           | `pnpm lint`             | pass                                                                                                                |
| Formatting                                                     | `pnpm format:check`     | pass                                                                                                                |
| Unit tests                                                     | `pnpm test:unit`        | 60 passed                                                                                                           |
| Integration tests (real PostgreSQL 16.15)                      | `pnpm test:integration` | 41 passed                                                                                                           |
| E2E smoke, desktop + mobile (production build, seeded test DB) | `pnpm e2e`              | 10 passed                                                                                                           |
| Production build                                               | `pnpm build`            | pass                                                                                                                |
| Dev server                                                     | `pnpm dev` → `GET /`    | 200                                                                                                                 |
| DB reachable, version, extensions                              | `pnpm db:check`         | PostgreSQL 16; `pg_trgm`, `unaccent` available                                                                      |
| Migrations from scratch on an empty DB                         | `pnpm db:migrate:fresh` | 28 tables, triggers installed                                                                                       |
| Seed idempotency                                               | `pnpm db:seed` ×3       | runs 2 and 3: no row-count changes, identical `max(updated_at)` on products/specs/offers, `price_history` unchanged |

What the tests cover:

- **App shell (e2e):** homepage renders with live DB counts; demo banner; `noindex` while demo data is on; theme toggle switches to dark tokens; real 404 status; `/api/health` reports the DB; no horizontal scroll at 390 px.
- **Env:** defaults, boolean parsing, fail-fast messages.
- **Unit registry:** 17 conversions (TB→GB decimal, TiB binary, ″/in, g↔kg, MHz→GHz, cm→mm, `-bit`, cd/m²→nits, min→h, lb→kg); locale number formats; incompatible and unknown units rejected; display formatting.
- **Validation:** slugs, the `-vs-` reservation, slugify, GTIN check digits.
- **Spec parsing:** every data type; min/max/step; enum canonical spelling; multi-select normalisation; "No" stored as `false`, distinct from a missing value; definition consistency rules.
- **Brands:** CRUD + audit; duplicates blocked case- and accent-insensitively (DB index); name/alias lookup; partial updates don't reset defaults; slug redirects without chains, including revert; the audit row rolls back with a failed write.
- **Categories:** ancestors in one recursive query; cycle prevention; spec-key clash on re-parent.
- **Products:** drafts only on create; publish/archive/unpublish/verify transitions; public lookup returns published only; `-vs-` blocked in Zod and by DB CHECK; global slug + per-brand case-insensitive model number uniqueness; date ordering on create and partial update; slug redirects; draft-only hard delete with confirmation; pagination clamp to 48; search vector includes the unaccented brand name.
- **Variants:** first variant becomes default; one default (service + partial unique index); GTIN check digits + uniqueness; regional variants never merged.
- **Specifications:** inheritance through one recursive CTE; key uniqueness across ancestors **and** descendants; inconsistent definitions and foreign groups rejected; canonical-unit storage; incompatible units/rule violations/foreign keys rejected; idempotent equal writes; **a verified value is never overwritten — a `conflicting_value` review item is created**; **AI-extracted values forced to unverified + `unverified_spec` review item**; variant overrides; DB `UNIQUE NULLS NOT DISTINCT`, exactly-one-value CHECK and verified-needs-timestamp CHECK; batched loading for a page of products.
- **Seed:** idempotent (counts + `updated_at` snapshot); every record `is_demo`; no admin users; all offer URLs on `.example`; covers stale, out-of-stock, refurbished, 3 currencies, a successor and an alternative per top-level category, 2 guides, 2 featured comparisons, one price-history row per offer; production guard.

### Done but not verified

- **Docker Compose PostgreSQL** (`pnpm db:up`): the file is written, but Docker Hub rate-limited the `postgres:16-alpine` pull in this environment (HTTP 429). Everything else was verified on a native PostgreSQL 16.15 with the same role and databases (see D18).
- **`EXPLAIN` review of query plans:** indexes exist per §5; a plan review on seeded data is scheduled for Stage 7 (§14).

### Deferred (by design — later stages)

- Services for retailers/offers, sources beyond `createSource`, relationships, images, links, guides, imports, review-queue resolution, admin users and rate limiting. Their **tables, constraints and indexes exist now**; the business logic arrives with the stage that uses it (5, 6A, 6B).
- `pnpm admin:create` (Stage 6A); `StorageDriver`, `SearchService`, markdown renderer (Stages 3–6).
- Header navigation, search and market selector (Stage 3; see D19).
- Security headers beyond `X-Content-Type-Options` and `Referrer-Policy` (CSP etc. in Stage 7).
- `docs/ARCHITECTURE.md`, `DATA_MODEL.md`, `DATA_ACQUISITION.md`, `DEPLOYMENT.md`, `ROADMAP.md` (Stage 8, §19).

### Notes for the next session

- Start Postgres (`pnpm db:up`, or a local service), then `pnpm db:migrate && pnpm db:seed`.
- `pnpm test:integration` and `pnpm e2e` **drop the schema of `TEST_DATABASE_URL`**; both refuse to run if it equals `DATABASE_URL`.
- The design board for cards, PDP and offers is at `design/project/Specbase Round 1 Directions.dc.html` (section 1a).
