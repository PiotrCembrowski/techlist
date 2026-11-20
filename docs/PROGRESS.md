# Progress

## Implementation plan

| Stage                     | Scope                                                                                                                                                                                                                                                                                             | Status   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1 Foundation              | Next.js 16 + strict TS, Tailwind 4 + shadcn conventions, 1a design tokens, ESLint/Prettier, Zod env, Docker Compose, Drizzle, Vitest + Playwright, app shell, `.env.example`, README                                                                                                              | **Done** |
| 2 Database                | Full schema + migrations, unit registry, services for brands/categories/products/variants/specifications, integration tests, idempotent seed                                                                                                                                                      | **Done** |
| 3 Public catalog          | Header nav + market selector (cookie), homepage sections, `/products`, `/categories/[slug]` with filters generated from definitions, brand pages, PDP with variants and grouped spec table, search (`SearchService`: exact model/MPN/GTIN → FTS → trigram) + suggestions, static pages. Journey A | **Done** |
| 4 Comparison              | Tray (localStorage), picker, `compareProducts()`, canonical `-vs-` URLs (301), responsive table. Journey B                                                                                                                                                                                        | **Done** |
| 5 Offers & affiliate      | Fresh/stale/expired rules, market grouping, `/go/[offerId]` with host allowlist, clicks, price-history writes. Journey C                                                                                                                                                                          | **Done** |
| 6A Admin core             | Auth.js credentials + argon2id, `admin:create`, Postgres rate limiter, role checks in every action, CRUD, audit log. Journey D                                                                                                                                                                    | Next     |
| 6B Imports & verification | CSV stage/validate/preview/commit, duplicate detection, error report, export with formula-injection guard, review queue, correction form. Journey E                                                                                                                                               | —        |
| 7 SEO & quality           | Metadata, JSON-LD, indexability function, sitemap/robots, slug 301s, axe, security headers/CSP                                                                                                                                                                                                    | —        |
| 8 Final                   | Full suite, mobile e2e, all docs, acceptance checklist                                                                                                                                                                                                                                            | —        |

Order of work inside each stage: schema/service → tests → UI → e2e journey → gate.

---

## Stage 5 — gate run 2026-11-20

### Done and verified

| Check                                                              | Command                                                                                | Result                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| Typecheck / lint / formatting                                      | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                                     | pass                                     |
| Unit tests                                                         | `pnpm test:unit`                                                                       | 110 passed                               |
| Integration tests (real PostgreSQL 16.15, seeded)                  | `pnpm test:integration`                                                                | 93 passed                                |
| E2E — Journeys A, B, C + catalogue + smoke; desktop **and** mobile | `pnpm e2e`                                                                             | 48 passed                                |
| Migrations from scratch + seed ×3                                  | `pnpm db:migrate:fresh && pnpm db:seed` ×3                                             | runs 2–3: no changes                     |
| Manual `/go` checks with curl on a production build                | valid → 302 + headers; tampered / malformed / expired → 404; click row holds host only | as expected                              |
| Visual check                                                       | offers on the product page: Poland (desktop) and All markets (390 px)                  | matches the 1a offers table; no overflow |

Built and covered by tests:

- **Offer display** (`groupOffers`): selected market first, other markets collapsed and labelled, stale offers below fresh ones with "price last checked N days ago, may have changed", expired/inactive/inactive-retailer offers never shown, ordering by availability → currency → price; variant-aware (`?variant=`). Product page: offer list with retailer, market + currency, condition, availability (icon + text), last checked (relative, exact time on hover), price with original price and shipping, Demo tags, `rel="sponsored nofollow"` links through `/go/`; "See N offers in <market>" button; honest empty state; affiliate disclosure next to every offer list (product page, comparison page) and in the footer.
- **`/go/[offerId]`**: UUID validation; active / unexpired / active retailer / published product / demo flag; target only from stored URLs, https, exact host allowlist (lookalike hosts, subdomains, credentials, custom ports, `http:` and `javascript:` all rejected); click recorded without IP/UA (referrer host only, bot flag); 302 with `no-store`, referrer policy and `X-Robots-Tag`. `HEAD` → 405.
- **Offer writes:** create/update/mark-checked with price history appended on create and price change only; currency, variant and URL-host validation; suspicious-price review items (configurable threshold).
- **Comparison page:** "Go to retailer" for each product's best fresh offer, plus the disclosure.
- **robots.txt** disallows `/admin`, `/api`, `/go`, `/search`.
- **Journey C** (desktop + mobile): product page with a fresh demo offer → retailer, price, currency, market, last checked visible → `/go/[offerId]` requested without following redirects → 302 to the configured demo URL → exactly one `affiliate_clicks` row; tampered/unknown/malformed/expired ids → 404 with no click recorded.

### Done but not verified

- Docker Compose database — still blocked by the Docker Hub rate limit in this environment.

### Deferred

- Offer CRUD screens, stale/expired offer lists and "mark as checked now" button → **Stage 6A** (the services exist and are tested).
- Resolving `suspicious_price` review items → Stage 6B (review queue).
- Offer JSON-LD (fresh, non-demo, in-market only) → Stage 7.

## Stage 4 — gate run 2026-11-20

### Done and verified

| Check                                                                    | Command                                                                                            | Result                                             |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Typecheck / lint / formatting                                            | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                                                 | pass                                               |
| Unit tests                                                               | `pnpm test:unit`                                                                                   | 87 passed                                          |
| Integration tests (real PostgreSQL 16.15, seeded)                        | `pnpm test:integration`                                                                            | 78 passed                                          |
| E2E — Journeys A + B, catalogue, smoke; desktop **and** mobile (Pixel 7) | `pnpm e2e`                                                                                         | 40 passed                                          |
| Migrations from scratch + seed ×3                                        | `pnpm db:migrate:fresh && pnpm db:seed` ×3                                                         | runs 2–3: no changes                               |
| Visual check                                                             | screenshots: tray on a category page, comparison (desktop), comparison scrolled sideways at 412 px | sticky header row + label column; no page overflow |

Built and covered by tests:

- **Comparison service** (`compareProducts`): 2–4 published products, deepest common category's comparable definitions (inherited included), canonical units, grouped rows, difference detection, direction-aware "better" marker per row (never an overall winner), "Not available" ≠ "No", manufacturer-claim label by source type, best fresh offer per product for the selected market; different top-level categories → explanatory page; unknown/unpublished → 404; renamed products → redirect.
- **URLs:** `/compare/[a]-vs-[b](-vs-…)`, max 4, canonical alphabetical order (other orders permanently redirect), invalid/duplicate/too few/too many → 404. Unit-tested parse, canonicalisation and round-trip.
- **Tray:** localStorage (try/catch, Zod-validated, cross-tab), max 4, thumbnails, remove/clear, category-mismatch prompt, "tray full" notice; compare toggles on every product card and on product pages; header **Compare** link with count (desktop) and menu entry (mobile).
- **Pages:** `/compare` (picker + current tray, jumps to the comparison once two are chosen, featured comparisons); comparison page with sticky product header (remove buttons, "Add product" slot), sticky labels, "Show only differences", search-as-you-type picker limited to the same category (`/api/compare/search`, rate-limited).
- **Featured comparisons** on the homepage, `/compare` and brand pages (only when every product is published).
- **Journey B** (desktop + mobile): category page → add two → comparison side by side → add a third via the picker → remove one → table and URL update; missing spec shows "Not available".

### Done but not verified

- Docker Compose database — still blocked by the Docker Hub rate limit in this environment.

### Deferred

- Offer list with `/go/` links on product and comparison pages → **Stage 5** (the comparison shows the best fresh price as text).
- Comparison-page indexability rules (all products indexable + canonical order) → Stage 7; comparison pages are currently `noindex` whenever a product is demo data.

## Stage 3 — gate run 2026-11-19

### Done and verified

| Check                                                                 | Command                                                                   | Result                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| Typecheck / lint / formatting                                         | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                        | pass                              |
| Unit tests                                                            | `pnpm test:unit`                                                          | 77 passed                         |
| Integration tests (real PostgreSQL 16.15, seeded)                     | `pnpm test:integration`                                                   | 69 passed                         |
| E2E — Journey A + catalogue + smoke, desktop **and** mobile (Pixel 7) | `pnpm e2e`                                                                | 28 passed                         |
| Migrations from scratch + seed ×3                                     | `pnpm db:migrate:fresh && pnpm db:seed` ×3                                | runs 2–3: no changes              |
| Manual route sweep on a production build                              | `curl` over 27 URLs                                                       | expected 200 / 308 / 404 for each |
| Visual check vs. the 1a board                                         | Playwright screenshots: home, category, PDP (desktop), PDP (390 px, dark) | matches; no horizontal scroll     |

Built and covered by tests:

- **Header:** Categories mega-menu (counts include subcategories), Products, Brands, Guides, search with suggestions, **market selector** (`market` cookie via a server action, ALL by default, never geo-detected), theme toggle; accessible mobile sheet (44 px targets).
- **Homepage:** hero + prominent search, live index counts, categories, featured products, recently added, brands by product count, latest guides. Sections without data are omitted.
- **Catalogue `/products`:** search, category, brand, status, price (single-currency market only) filters; sort newest/name/release date/lowest price; crawlable `?page=` pagination (≤ 48).
- **Category pages:** intro, subcategories, **filters generated from filterable definitions incl. inherited** (numeric ranges in canonical units with observed min/max, options, yes/no), results include subcategories, brands in category, related guides; filtered URLs `noindex, follow` + canonical; empty form fields redirect to clean URLs.
- **Brand pages:** monogram (no licensed logo), overview, origin, website, categories, families, latest and discontinued models.
- **Product pages:** breadcrumbs (category path › brand › product), model number, dates, status, verification badge → policy, image placeholder, summary, **variant selector (`?variant=`) with variant overrides**, key specs, full grouped `<table>` with `th scope` and **"Not available"** distinct from "No", per-value "unverified" marks, derived predecessor + successor, alternatives, permitted manufacturer links, data sources + required-spec coverage, related guides. Drafts/archived → 404; wrong brand slug and old slugs → permanent redirect.
- **Search:** `SearchService` interface + Postgres implementation — exact model/MPN/GTIN first (GTIN links to the variant), prefix full-text, trigram fuzzy; separate brand and category groups; highlighting; "did you mean"; empty state with categories; `noindex, follow`. `/api/search/suggest`: ≤ 8 products, debounced client combobox with ARIA listbox and keyboard support, **rate-limited** (Postgres fixed window, hashed client key).
- **Guides:** index and detail, sanitised Markdown (no raw HTML), linked products and categories.
- **Static pages:** About, Affiliate disclosure (stale threshold read from `OFFER_STALE_HOURS`), Data & verification policy, Privacy; linked from the footer.
- **Filter queries tested:** numeric range (incl. variant values), enum any-of, multi-select, boolean yes/no (missing ≠ No), inherited filters on a child category, brand + status + text, pagination ordering, price filter and price sort per market, stale/expired/out-of-stock excluded from "lowest price".

### Done but not verified

- Docker Compose database — still blocked by the Docker Hub rate limit here (see Stage 1+2).
- No automated accessibility audit yet (axe is Stage 7); keyboard paths for search, menus and filters were exercised by e2e.

### Deferred (by design — see D32)

- Compare link, card compare toggles, featured comparisons (homepage, brand page) → **Stage 4**.
- Offer list on product pages, `/go/[offerId]`, click recording → **Stage 5**. Cards already show the lowest fresh offer (text only).
- Suggest a correction → Stage 6B. Product images and brand logos → uploads in Stage 6A.
- ISR / on-demand revalidation and `EXPLAIN` review of search and filter queries → Stage 7 (D29, D31).

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
