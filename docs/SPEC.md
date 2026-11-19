# MASTER BUILD SPEC v2: PREMIUM GLOBAL TECHNOLOGY PRODUCT DATABASE

---

# 0. HOW TO USE THIS DOCUMENT (READ FIRST)

This spec is too large to finish in one session. Building all of it in one go will exhaust the context and the later stages (admin, CSV import, tests) will come out shallow. Work in **separate sessions, one or two stages each**, as follows.

## 0.1 First session only

1. Inspect the repository: existing code, configuration, dependencies, git status, available tooling (Node version, package manager, Docker, Playwright browsers). Report any conflicts with this spec.
2. Save this document, unchanged, to `docs/SPEC.md`. That file is the source of truth from now on.
3. Create `CLAUDE.md` in the repo root containing:
   - Section 2 (Non-negotiable rules), copied verbatim.
   - The project's actual commands (dev, build, typecheck, lint, test, e2e, db:migrate, db:seed), once they exist.
   - A pointer: "Full specification: docs/SPEC.md. Progress: docs/PROGRESS.md. Decisions: docs/DECISIONS.md."
4. Write a concise implementation plan (≤ 1 page) into `docs/PROGRESS.md`.
5. Implement **Stage 1 and Stage 2 only** (Section 16). Then run the stage gate (0.3) and stop.

## 0.2 Every later session

The session prompt will be: *"Read CLAUDE.md, docs/SPEC.md and docs/PROGRESS.md. Implement Stage N."*

Implement only that stage. Do not start the next stage.

## 0.3 Stage gate (end of every stage)

1. Run typecheck, lint, unit/integration tests, and the e2e journeys that belong to the stage. Fix failures.
2. Run migrations from scratch against an empty database and re-run the seed twice to confirm idempotency (from Stage 2 onward).
3. Update `docs/PROGRESS.md` with:
   - **Done and verified**: features whose behavior you tested, and how.
   - **Done but not verified**: anything you could not test, and why.
   - **Deferred**: what was cut and why.
4. Record non-obvious engineering decisions in `docs/DECISIONS.md` (one short entry each: decision, reason, alternatives).
5. If the repository uses git, commit with a message like `stage N: <summary>`.
6. Report a short summary and stop.

## 0.4 Honesty about status

- Never report a check as passing unless you ran it in this session and saw it pass.
- If the environment lacks something (Docker, a Postgres instance, Playwright browsers, network access), say so plainly, write the code and tests anyway, and list them under "Done but not verified". **Do not substitute SQLite, in-memory fakes or hardcoded arrays for PostgreSQL** to make things appear to work.
- When something is unspecified, make a sensible decision, log it in `docs/DECISIONS.md`, and continue. Ask only if a decision is destructive or irreversible (e.g. deleting existing code you didn't write).

---

# 1. ROLE AND PRODUCT

## 1.1 Role

Act as a senior full-stack engineer and pragmatic startup CTO with strong PostgreSQL, product design and SEO skills. You are working directly in my repository with Claude Code. Build, run, test and fix; don't just explain.

## 1.2 Product

A premium global technology product discovery, comparison and affiliate shopping platform where users can research, compare and find retailers selling technology hardware.

It combines:

- A structured technology product catalog with category-specific specifications.
- Search and specification-based filtering.
- Side-by-side comparison of up to four products.
- Brand and category directories.
- Product families, generations and regional variants.
- Retailer offers with affiliate links and honest freshness information.
- Product relationships (successors, alternatives, accessories).
- Data provenance and verification status, visible to users.
- A private administration dashboard.

Reference points for quality (do **not** copy their design, branding, text or data): GSMArena's structured specs, RTINGS' clarity, a modern discovery engine, a serious price-comparison site.

**Positioning:** premium, professional, trustworthy, global. It must not feel like an affiliate blog or an ecommerce template.

## 1.3 Primary user goals

1. Find a product by name, model number, brand or specification.
2. Browse by category and brand.
3. Filter by category-relevant specifications.
4. Compare up to four products.
5. Understand differences between models and variants.
6. Find current retailer offers in their market, and see when each was last checked.
7. Discover alternatives, predecessors and successors.
8. See the source and verification status of product information.

## 1.4 Market

Global catalog and global shopping ambition. Interface in English at launch. The architecture must support multiple countries, currencies, country-specific retailers, regional variants and international affiliate networks, and future languages. Never assume a retailer or affiliate program covers every country.

---

# 2. NON-NEGOTIABLE RULES

These rules apply everywhere and override any other section.

## 2.1 Data integrity

1. Never fabricate products, specifications, prices, retailers, offers, reviews, ratings, review counts, availability or endorsements.
2. **Demo data:** all seeded data is fictional and every demo record has `is_demo = true`. Demo records are labeled "Demonstration data" in the UI, are always `noindex`, are excluded from the sitemap and structured data, and the demo seed refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`.
3. Use fictional brands and products only. Pick names that are obviously invented and do not resemble real trademarks. Do not seed real products: you cannot verify their specifications or image rights in this environment.
4. Demo retailers and demo offers are allowed **only** under rule 2, using reserved domains such as `https://shop.demo-retailer.example/...` (RFC 2606). They must never be presented as real offers.
5. Keep product data separate from offer data; keep products separate from variants; never silently merge regional variants.
6. Record the provenance (source) of important data. Never display unverified data as verified.
7. Never silently overwrite a `verified` specification with lower-confidence data; create a review item instead.
8. AI-extracted values are always `unverified` until a human approves them.
9. Do not import data from sources whose usage rights are unknown or do not permit it. Do not assume manufacturer or retailer images may be redistributed.
10. Do not build scrapers. Do not bypass access controls or anti-bot systems. Do not make real external network requests unless credentials and authorization are explicitly configured. Never invent API credentials.

## 2.2 Architecture

1. Modular monolith. No microservices, Kubernetes, Redis, Elasticsearch, Kafka or similar unless a measured requirement justifies it. Cheap to run.
2. Strict TypeScript. Validate all external input with Zod.
3. Business logic lives in `src/modules/*` service functions, not in page components or route handlers.
4. All catalog data comes from the database. No hardcoded arrays in application code; demo data lives only in seed files.
5. Every list query is paginated or explicitly limited. No unbounded queries, no N+1 patterns.
6. All schema changes go through Drizzle migrations.

## 2.3 Product quality

1. No buttons or links that look functional but do nothing. If a feature isn't implemented, hide it or label it "Coming soon" without an interactive control.
2. A homepage section that has no real data behind it is omitted, not faked (e.g. no "Trending" without real analytics).
3. A feature is complete only when its underlying behavior is tested, not when its UI exists.
4. All public pages are responsive and accessible (keyboard navigation, focus states, labels, contrast, semantic HTML).

---

# 3. TECHNOLOGY STACK

Use this stack unless the existing repository has a compelling, compatible alternative (log the decision).

| Concern | Choice |
|---|---|
| Runtime | Node.js current LTS; package manager: whatever the repo uses, else pnpm |
| Framework | Next.js (current stable), App Router, React Server Components by default; Client Components only for interaction |
| Styling | Tailwind CSS, shadcn/ui, Lucide icons, CSS-variable design tokens |
| Database | PostgreSQL **16** (needed for `UNIQUE NULLS NOT DISTINCT`), extensions `pg_trgm` and `unaccent` |
| ORM / migrations | Drizzle ORM + Drizzle Kit |
| Validation | Zod, schemas shared between forms, server actions and imports |
| Auth | Auth.js (v5) Credentials provider, admin users stored in the DB, passwords hashed with argon2id. No public registration. The first admin is created by a CLI script (`pnpm admin:create`), never by the seed and never with a default password |
| Rate limiting | Postgres-backed fixed-window limiter (no Redis) behind an interface |
| Search | PostgreSQL full-text search + `pg_trgm`, behind a `SearchService` interface |
| Storage | `StorageDriver` interface with a local-filesystem driver (dev) and an S3-compatible driver (prod) |
| Markdown (guides) | A markdown renderer with HTML sanitization (no raw HTML passthrough) |
| Unit/integration tests | Vitest; integration tests run against a real Postgres test database |
| E2E tests | Playwright |
| Local infra | Docker Compose for PostgreSQL 16 |
| Hosting | Vercel-compatible; managed Postgres; S3-compatible storage. No deployment-specific hardcoding |

---

# 4. APPLICATION STRUCTURE

Suggested layout; adapt if needed but keep the separation:

```text
src/
  app/
    (public)/            # homepage, products, categories, brands, compare, guides, search
    admin/               # login, dashboard, products, categories, brands, retailers, offers,
                         # imports, sources, review-queue, settings
    go/[offerId]/        # affiliate redirect route handler
    api/                 # search suggestions, admin APIs, import uploads
    sitemap.ts  robots.ts  layout.tsx  globals.css  not-found.tsx
  components/            # layout, navigation, product, comparison, catalog, search,
                         # filters, offers, seo, admin, ui (shadcn)
  db/                    # schema/, migrations/, seed/
  lib/                   # auth, db, search, seo, currency, units, formatting,
                         # validation, storage, affiliate, rate-limit, product-matching
  modules/               # products, variants, brands, categories, specifications,
                         # retailers, offers, comparisons, sources, imports,
                         # relationships, guides, review-queue, audit
  config/  types/
tests/  unit/  integration/  e2e/
scripts/  admin/  import/  seed/  maintenance/
```

Service functions for important operations, e.g. `createProduct()`, `updateProduct()`, `publishProduct()`, `createProductVariant()`, `setSpecificationValue()`, `searchProducts()`, `compareProducts()`, `createRetailerOffer()`, `stageCsvImport()`, `commitCsvImport()`, `findDuplicateCandidates()`, `verifyProduct()`. Mutating services write an audit log entry in the same transaction.

---

# 5. DATA MODEL

## 5.1 Conventions

- UUID primary keys (`gen_random_uuid()`).
- `created_at` / `updated_at` as `timestamptz` (UTC) on all mutable entities.
- Slugs: lowercase `a-z0-9-`, validated by one shared Zod schema. Product slugs may not contain the substring `-vs-` (reserved for comparison URLs).
- `is_demo boolean not null default false` on: brands, products, retailers, retailer_offers, sources, guides.
- Enums as Postgres enums or `text` + `CHECK`; be consistent.
- Country codes: ISO 3166-1 alpha-2 (`CHECK (code ~ '^[A-Z]{2}$')`). Currency codes: ISO 4217 (`CHECK (code ~ '^[A-Z]{3}$')`).
- Money: `numeric(14,4)`, never float. Format using the currency's minor units at display time.

## 5.2 Tables

### brands
id, name, slug (unique), description, official_website_url, logo_image_key, country_of_origin, aliases `text[]`, is_active, is_demo, timestamps.
- Unique index on `lower(unaccent(name))` to block case/spelling duplicates.
- GIN index on aliases. Brand lookup during import checks name and aliases case-insensitively.

### categories
id, parent_id (self FK), name, slug (unique), description, icon, sort_order, seo_title, seo_description, is_active, timestamps.
- Specification definitions are **inherited from ancestor categories** (e.g. "Gaming laptops" inherits "Laptops" definitions). Resolve with a recursive CTE in one query.

### product_families
id, brand_id, category_id, name, slug (unique per brand), description, timestamps.

### products
id, brand_id, category_id, family_id (nullable), name, slug (**globally unique**), model_name, model_number, manufacturer_part_number, aliases `text[]`, description, short_description, release_date, announced_date, discontinued_date, product_status, **publication_status**, verification_status, last_verified_at, is_featured, is_demo, seo_title, seo_description, timestamps.
- `product_status`: `announced | active | discontinued | unknown`.
- `publication_status`: `draft | published | archived`. Only `published` products are public. "Delete" in the admin means archive; hard delete only for drafts, with confirmation.
- `verification_status`: `draft | needs_review | partially_verified | verified | rejected`. (No separate `is_verified` column; derive it.)
- No `canonical_url` column; canonical URLs are computed from slugs. No `main_image_id`; the primary image is `product_images.is_primary`.
- Indexes: unique `(brand_id, lower(model_number))` where model_number is not null; trigram GIN on name, model_number, MPN; GIN on aliases; a generated `tsvector` column (name, model_name, model_number, aliases, brand name via trigger or denormalized column) with GIN index.

### product_variants
id, product_id, variant_name, variant_code, manufacturer_part_number, region_code (ISO country or region code such as `EU`, nullable = global), color, memory_configuration, storage_configuration, configuration_label, barcode_gtin, sku, is_default, is_active, timestamps.
- Unique GTIN where not null. Partial unique index: one `is_default = true` per product.
- Validate GTIN check digits.

### specification_groups
id, category_id, key, name, display_order. (For example "Display", "Performance", "Battery". Inherited like definitions.)

### specification_definitions
id, category_id, group_id, key, name, description, data_type, canonical_unit, display_order, is_filterable, is_comparable, is_required, is_public, comparison_direction, validation_rules `jsonb`, timestamps.
- `data_type`: `text | integer | decimal | boolean | date | enum | multi_select`.
- `comparison_direction`: `higher_is_better | lower_is_better | none` (used only to highlight; never to produce an overall "winner").
- `validation_rules` (validated by Zod): min, max, step, allowed enum options, max length.
- `key` unique within a category's full inheritance chain (enforce in the service layer).

Example definitions to seed (canonical units in brackets):
- **Laptop:** processor, ram [GB], storage [GB], screen_size [in], resolution, refresh_rate [Hz], weight [kg], battery_capacity [Wh]
- **Smartphone:** screen_size [in], chipset, ram [GB], storage [GB], rear_camera_main [MP], battery_capacity [mAh], charging_power [W], operating_system
- **CPU:** cores, threads, base_clock [GHz], boost_clock [GHz], tdp [W], socket
- **GPU:** architecture, vram [GB], memory_type, memory_bus [bit], board_power [W], interface, length [mm]
- **Monitor:** screen_size [in], resolution, panel_type, refresh_rate [Hz], response_time [ms], brightness [nits], hdr_support
- **Headphones:** form_factor, driver_size [mm], noise_cancelling, battery_life [h], connectivity, weight [g]

### product_specifications
id, product_id, variant_id (nullable = applies to all variants), specification_definition_id, value_text, value_numeric, value_boolean, value_date, value_json (for multi_select), source_id, origin, confidence, verification_status, last_verified_at, timestamps.
- `origin`: `manual | import | ai_extracted`. `confidence`: numeric 0–1, nullable.
- `UNIQUE NULLS NOT DISTINCT (product_id, variant_id, specification_definition_id)`.
- `CHECK` that exactly one value column is non-null.
- Values are always stored in the definition's **canonical unit**. A unit registry (`src/lib/units`) converts input such as `"1 TB"` to `1000` GB (decimal SI for storage), `"15.6\""` to inches, etc. Inputs with incompatible units are rejected.
- A variant-level value overrides the product-level value for that variant.
- Index on `(specification_definition_id, value_numeric)` for filtering.

### sources
id, source_name, source_type, source_url, provider_name, license_type, license_notes, access_method, retrieved_at, attribution_required, usage_permitted, is_demo, timestamps.
- `source_type`: `manufacturer | licensed_provider | retailer | affiliate_network | manual_research | ai_extraction | community_submission`.
- Imports must refuse a source with `usage_permitted = false`.

### product_source_records
id, product_id, variant_id, source_id, source_product_identifier, source_url, raw_data_reference, retrieved_at, notes, created_at.

### product_links
id, product_id, link_type (`official | support | manual | driver | spec_sheet`), url, source_id, created_at. Only links that the source permits are displayed.

### product_images
id, product_id, variant_id, storage_key, alt_text, image_type, source_id, license_type, attribution_text, display_order, is_primary, created_at.
- Partial unique index: one `is_primary` per product. Uploaded files only (no hotlinking external URLs). Placeholder image component when none exists.

### product_relationships
id, source_product_id, target_product_id, relationship_type, confidence, source_id, is_verified, created_at.
- Types: `successor | alternative | competitor | compatible_with | accessory_for | related`.
- **Store "successor" only; derive "predecessor"** as the inverse, so the two can never disagree.
- `UNIQUE (source_product_id, target_product_id, relationship_type)`, `CHECK (source_product_id <> target_product_id)`.

### retailers
id, name, slug (unique), website_url, allowed_redirect_hosts `text[]`, logo_image_key, country_code (home market), supported_currencies `text[]`, affiliate_network, is_active, is_demo, timestamps.

### retailer_offers
id, product_id, variant_id (nullable), retailer_id, retailer_product_id, market_country_code, product_url, affiliate_url (nullable), currency, price_amount, original_price_amount, shipping_cost, availability_status, condition, source_id, last_checked_at, expires_at, is_active, is_demo, timestamps.
- `availability_status`: `in_stock | out_of_stock | preorder | unknown`. `condition`: `new | used | refurbished`.
- `CHECK (price_amount > 0)`; currency must be in the retailer's supported_currencies (service-level check).
- **Stale** = `last_checked_at` older than `OFFER_STALE_HOURS` (env, default 72). **Expired** = `expires_at < now()`.
- Display rules: expired or inactive offers are never shown; stale offers are shown below fresh ones with a visible "Price last checked X days ago, may have changed" warning and are excluded from structured data and from "lowest price".
- Indexes: `(product_id, market_country_code, is_active)`, `(variant_id)`, `(last_checked_at)`.

### price_history
id, offer_id, product_id, variant_id, retailer_id, currency, price_amount, recorded_at, source_id.
- Append-only (no update or delete in application code). A row is written when an offer is created and whenever its price changes.
- Index `(product_id, recorded_at desc)`.

### affiliate_clicks
id, offer_id, clicked_at, market_country_code (from the market cookie), referrer_host (host only, not the full URL), is_probable_bot.
- Do not store IP addresses or full user agents.

### guides, guide_products, guide_categories
guides: id, title, slug (unique), summary, body_markdown, author_name, publication_status, published_at, seo_title, seo_description, is_demo, timestamps. Link tables connect guides to products and categories.

### featured_comparisons
id, title, product_ids `uuid[]` (2–4), sort_order, is_active. Editor-curated; replaces fake "popular comparisons".

### slug_redirects
id, entity_type, old_slug, new_slug, created_at. Written automatically when a product, brand, category or guide slug changes; public routes 301 from old to new.

### import_jobs and import_rows
import_jobs: id, source_id, import_type (`products | offers`), file_name, file_checksum, column_mapping `jsonb`, status (`uploaded | validated | committed | failed | cancelled`), total_rows, successful_rows, failed_rows, skipped_rows, created_by, started_at, completed_at.
import_rows: id, job_id, row_number, raw `jsonb`, normalized `jsonb`, row_hash, action (`create | update | skip | conflict | error`), errors `jsonb`, matched_product_id, matched_variant_id.
- Staging table makes preview, error reports and idempotency possible: re-importing a row whose `row_hash` already matches the stored record results in `skip`.

### review_items (verification queue)
id, item_type, entity_type, entity_id, payload `jsonb`, status (`open | approved | rejected`), created_by (nullable), resolved_by, resolved_at, resolution_note, created_at.
- `item_type`: `new_product | unverified_spec | conflicting_value | duplicate_candidate | variant_ambiguity | correction | suspicious_price`.
- Suspicious price = deviates > 50% from the product's median current price in the same currency (configurable).

### admin_users
id, email (unique, lowercase), name, password_hash, role (`owner | editor`), is_active, last_login_at, timestamps. Role checks happen server-side on every admin action.

### audit_logs
id, admin_user_id, entity_type, entity_id, action, previous_data `jsonb`, new_data `jsonb`, created_at. Never store password hashes or secrets in audit payloads.

### rate_limits
key, window_start, count (primary key `(key, window_start)`), used by the Postgres limiter.

---

# 6. GLOBALIZATION

- Store all timestamps in UTC; format dates/times in the user's locale on display.
- Use `Intl.NumberFormat` for currency with the currency's minor units.
- Keep the original price and currency of every offer. No conversion in the MVP (later: a separate exchange-rate table with source and timestamp, displayed as "approx.").
- **Market selector** (header): sets a `market` cookie (ISO country code, or `ALL`). On product pages, offers for the selected market are shown first; offers from other markets appear in a collapsed "Other markets" section with their market clearly labeled. Default market: `ALL` (do not geo-detect in the MVP).
- **Price filter** on catalog and category pages is shown only when a specific market is selected, and filters on the lowest fresh offer in that market's currency. It is hidden for `ALL`, because prices in different currencies can't be compared without conversion.
- Never imply global availability because a product exists globally.

---

# 7. PUBLIC WEBSITE

## 7.1 Homepage

1. Compact premium header.
2. Prominent search.
3. Hero: headline "Discover. Compare. Choose smarter." Supporting text: "Explore technology products, compare specifications and find offers from retailers around the world."
4. Categories.
5. Featured products (`is_featured`).
6. Recently added products.
7. Featured comparisons (`featured_comparisons`).
8. Brands (ordered by number of published products).
9. Latest guides.
10. Footer with About, affiliate disclosure, data & verification policy, contact, privacy.

Omit any section with no data. No "Trending" section until real analytics exist.

## 7.2 Header

Logo/wordmark, Categories (menu), Brands, Compare (with a count of the products in the comparison tray), Guides, search, market selector, accessible mobile navigation.

## 7.3 Product catalog `/products`

Search, category filter, brand filter, product status filter, price filter (per Section 6), sort (newest, name, release date, lowest price when a market is selected), product cards, server-side pagination with crawlable `?page=` links (max 48 per page).

## 7.4 Category pages `/categories/[slug]`

Introduction, child categories, **category-specific filters generated from filterable specification definitions** (including inherited ones; no GPU filters on headphone pages), results, sort, brands in this category, related guides, SEO metadata. Filter state lives in the URL query string.

## 7.5 Brand pages `/brands/[slug]`

Logo, overview, official website, categories, product families, latest models, discontinued models, featured comparisons involving the brand.

## 7.6 Product detail `/products/[brand-slug]/[product-slug]`

The most important page. Include:

1. Breadcrumbs (Category path › Brand › Product).
2. Brand and product name; model number; release/announce/discontinued dates; product status.
3. Image gallery (licensed uploads or placeholder).
4. Short summary.
5. Verification badge with a link to the data & verification policy.
6. Variant selector (updates the URL with `?variant=<code>`; variant-specific specs and offers update accordingly).
7. Key specification highlights (the first 4–6 comparable specs).
8. Full specification table, grouped by specification group, with units formatted.
9. Retailer offers: retailer, price, currency, condition, availability, market, last checked, stale warning where relevant, affiliate disclosure. Links go through `/go/[offerId]` with `rel="sponsored nofollow"`.
10. Honest empty state when there are no offers ("We don't have current retailer offers for this product yet.").
11. Add-to-compare action.
12. Predecessor / successor, alternatives, related products.
13. Official, support and manual links (only where the source permits).
14. Data sources and last verification date.
15. Related guides.
16. "Suggest a correction" link (Section 9.7).

Rules: draft or archived products return 404. If the brand slug in the URL doesn't match the product's brand, 301 to the correct URL. Old slugs 301 via `slug_redirects`.

## 7.7 Comparison

- A comparison tray (client state in `localStorage`, wrapped in try/catch) lets users collect up to four products from cards and product pages.
- `/compare` shows a product picker (search-as-you-type) and the current comparison.
- Shareable URL `/compare/[slug-a]-vs-[slug-b](-vs-...)`, maximum four. **Canonical form sorts slugs alphabetically**; any other order 301s to the canonical URL. Unknown slugs → 404.
- All products must share the same top-level category. Otherwise show a clear message and offer to compare within one category.
- Rows: comparable definitions of the shared category (including inherited ones), grouped, with normalized canonical units.
- Highlight differences between products. Where `comparison_direction` is set, mark the better value per row; never compute an overall "winner" score.
- Missing values show "Not available", which is visually distinct from "No".
- Distinguish manufacturer-claimed values from independent measurements when the source type indicates it.
- Show the best fresh offer per product for the selected market.
- Remove controls per product; the URL updates on removal.
- Mobile: sticky product header with horizontal scroll, or a stacked per-spec layout; the spec label must stay visible.

## 7.8 Search `/search`

- Suggestions endpoint `/api/search/suggest?q=` (debounced, max 8 results, thumbnails, brand and category matches).
- Ranking: exact model number / MPN / GTIN match first, then full-text rank, then trigram similarity; brand and category matches returned as separate groups.
- Result highlighting, useful empty state (suggest categories and spelling alternatives), mobile-friendly.
- Search result pages are `noindex, follow`.

## 7.9 Guides `/guides` and `/guides/[slug]`

Database-backed guides authored in markdown (sanitized) and linked to products and categories. No automated mass generation of SEO pages.

## 7.10 Static pages

About, Affiliate disclosure, Data & verification policy (explains verification statuses and sources), Privacy, custom 404.

---

# 8. DESIGN SYSTEM

Original visual identity: premium, minimal, editorial, technology-oriented, spacious, with strong typographic hierarchy and an excellent mobile experience.

- Refined neutral palette + one restrained accent color, defined as CSS variables. Light and dark mode via `class` strategy and the same tokens.
- Consistent spacing, type scale, borders, radii, shadows, buttons, form controls, tables, and loading/error/empty states.
- Avoid heavy gradients, glassmorphism, large decorative animations, dashboard aesthetics on public pages, crowded cards, excessive badges, popups.
- Product information is the visual priority.

**Product card:** image, brand, name, one distinguishing line (e.g. configuration or year), 3–4 key specs, lowest fresh offer for the selected market (if any), compare toggle, details link. No ratings or review counts.

**Specification tables:** grouped, scannable, consistent per category, responsive, accessible (`<table>` with `<th scope>`), comparable.

---

# 9. ADMIN

All admin routes, route handlers and server actions require an authenticated, active admin with the right role. Authorization is checked **server-side in each action**, not only in middleware. Admin pages are `noindex` and disallowed in robots.txt.

## 9.1 Dashboard

Counts: products (by publication and verification status), variants, active retailers, active offers, stale offers, open review items; recent imports; recent audit log entries.

## 9.2 Products

Create, edit, publish, archive (with confirmation), manage variants, specifications (editor generated from the category's definitions, with per-type inputs, unit-aware input and validation), images (upload with type/size validation), brand, category, family, relationships, sources and source records, links, verification status. Every change writes an audit log entry.

## 9.3 Categories

CRUD with parent selection (prevent cycles), specification groups and definitions (including filterable/comparable/required flags and comparison direction), SEO fields.

## 9.4 Brands

CRUD, logo upload, aliases, official website. Warn on likely duplicates (trigram similarity).

## 9.5 Retailers and offers

Retailer CRUD (including allowed redirect hosts). Offer CRUD with currency, market, condition, availability, product URL, affiliate URL, expiry, "mark as checked now". Stale and expired offer lists.

## 9.6 CSV import and export

Workflow:
1. Download template (products template and offers template).
2. Upload (max 5 MB, 10,000 rows, `.csv` only, UTF-8; reject anything else).
3. Map columns (auto-map by header name; manual override).
4. Validate every row with Zod into `import_rows`.
5. Preview: counts and rows per action (`create / update / skip / conflict / error`).
6. Duplicate detection (in order): exact GTIN; brand + MPN; brand + normalized model number; trigram name similarity ≥ 0.6 within the brand → `duplicate_candidate` review item (never auto-merge on similarity).
7. Review errors per row.
8. Confirm: commit valid rows in batched transactions; rows that would overwrite a `verified` spec become `conflicting_value` review items instead.
9. Results page.
10. Download the error report as CSV.

Products template: one row per variant. Columns: `brand, category_slug, product_name, model_number, mpn, product_status, release_date, variant_name, variant_code, region_code, color, memory, storage, gtin, source_name, source_url`, plus one column per spec as `spec.<key>`. Values may include units (`1 TB`), which are converted to the canonical unit.

Offers template: `retailer_slug, product_model_number or gtin, variant_code, market_country_code, currency, price, original_price, shipping_cost, condition, availability, product_url, affiliate_url, last_checked_at, expires_at`.

Export uses the same formats (round-trippable). **Prevent CSV formula injection** on export: prefix cells starting with `= + - @` with `'`.

Re-importing the same file must produce zero new records.

## 9.7 Verification queue

Lists open review items by type with filters. The admin can approve, reject (with note), or edit-then-approve. Approval applies the change in a transaction and writes an audit entry.

Public "Suggest a correction" form on product pages: field (optional spec), suggested value, source URL, optional email. Protected by rate limiting and a honeypot field; creates a `correction` review item. No accounts.

---

# 10. DATA ACQUISITION

Source hierarchy: manufacturer documentation → licensed providers → approved affiliate feeds/APIs → retailer feeds → manual research → AI-assisted extraction → community corrections (reviewed).

Adapter interface:

```ts
interface ProductDataProvider {
  readonly name: string;
  readonly sourceId: string;
  isConfigured(): boolean;
  fetchProducts(options?: { since?: Date; limit?: number }): Promise<unknown[]>;
  normalizeProduct(raw: unknown): Promise<NormalizedProduct>; // validated by Zod
}
```

Implement the CSV adapter fully. Create stub adapters for manufacturer files, licensed feeds and affiliate feeds: they implement the interface, return `isConfigured() = false` without credentials, are shown as "Not configured" in admin settings, and make no network calls. Document how to configure them.

AI extraction: design the hook only (`origin = ai_extracted`, `confidence`, review item). Do not integrate a provider in the MVP.

---

# 11. AFFILIATE REDIRECTS

Route `/go/[offerId]`:

1. Validate `offerId` is a UUID; otherwise 404.
2. Load the offer; it must be active, not expired, and its retailer active. Demo offers redirect only when `ENABLE_DEMO_DATA=true`.
3. Target = `affiliate_url ?? product_url`. It must be `https:` and its host must be in the retailer's `allowed_redirect_hosts` (affiliate network hosts are added there explicitly). Otherwise 404 and log a warning. **Never redirect to a URL taken from the request.**
4. Insert an `affiliate_clicks` row (simple bot detection by user-agent keywords sets `is_probable_bot`).
5. Respond 302 with `Cache-Control: no-store` and `Referrer-Policy: strict-origin-when-cross-origin`.

`/go/` is disallowed in robots.txt and responses carry `X-Robots-Tag: noindex`. An affiliate disclosure appears near every offer list and in the footer.

---

# 12. SEO

- Unique titles and meta descriptions (from SEO fields with sensible fallbacks), canonical URLs, Open Graph and Twitter metadata, breadcrumbs, semantic HTML, descriptive alt text, internal links, crawlable pagination, real 404 status, 301s for changed slugs.
- Structured data (JSON-LD): Organization and WebSite (with SearchAction) on the homepage; BreadcrumbList; Product on indexable product pages; **Offer only for fresh, non-demo, in-market offers**; Article for guides. Never output Review or AggregateRating.
- **Indexability rules** (one function, unit-tested):
  - Product page indexable only if published, not demo, verification `verified` or `partially_verified`, and at least 60% of required specs present.
  - Category page indexable only if it has ≥ 1 indexable product. Filtered category URLs: `noindex, follow`, canonical to the unfiltered page.
  - Comparison pages indexable only when all products are indexable, and only in canonical order.
  - `noindex`: admin, search results, demo records, thin/empty pages, utility pages.
- `sitemap.ts` generated from indexable records only (split into multiple sitemaps when > 50,000 URLs).
- `robots.ts` disallows `/admin`, `/api`, `/go`, `/search`.

---

# 13. SECURITY AND RELIABILITY

- Auth: argon2id hashes, secure HTTP-only SameSite cookies, session invalidation on deactivation.
- Rate limits: login (5 attempts / 15 min per IP + email), correction form, search suggestions, imports.
- CSRF: rely on Server Actions' origin checks; mutating route handlers verify the `Origin` header.
- Zod validation on every input; Drizzle parameterized queries only (no string-built SQL).
- Safe redirects (Section 11). Sanitized markdown. No `dangerouslySetInnerHTML` except JSON-LD serialized safely.
- Uploads: MIME and magic-byte check, size limits, random storage keys, no SVG uploads (XSS risk) unless sanitized.
- CSV injection protection on export.
- Basic security headers (CSP suitable for Next.js, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` for admin).
- Environment variables validated at startup with Zod (`src/config/env.ts`); `.env.example` committed, real secrets never committed.
- Structured server-side error logging without personal data or secrets.
- Database transactions for multi-step writes.
- Backup and restore guide (`pg_dump` / `pg_restore`) in `docs/DEPLOYMENT.md`.

---

# 14. PERFORMANCE

- Server Components; static generation / ISR for catalog pages with on-demand revalidation when admin changes publish.
- Indexes per Section 5; check important queries with `EXPLAIN` on seeded data.
- Pagination everywhere (max 48 cards per page, max 20 search results per request).
- Fetch spec values for a page of products in one query (no N+1).
- `next/image` with sized placeholders; lazy-load below the fold.
- Minimal client JavaScript: only search suggestions, compare tray, variant selector, filters and admin forms are Client Components.

---

# 15. DEMO DATA

- Seed script `pnpm db:seed` (idempotent: upserts by slug or natural key; running twice changes nothing).
- Fictional brands (3–4), with categories Smartphones, Laptops, CPUs, GPUs, Monitors, Headphones; 3–5 products per category; some products with 2–3 regional/configuration variants; specification definitions per Section 5; at least one successor relationship and one alternative per category; one demo source (`source_type = manual_research`, `is_demo = true`).
- Two demo retailers on `.example` domains in different markets/currencies, with demo offers: some fresh, one stale, one out of stock, so each display state can be tested.
- Two demo guides and two featured comparisons.
- Everything with `is_demo = true`. A visible site-wide banner appears when `ENABLE_DEMO_DATA=true`.
- No admin user in the seed; use `pnpm admin:create`.

---

# 16. STAGES

Each stage ends with the stage gate (Section 0.3). Suggested sessions: **[1+2]**, **[3]**, **[4+5]**, **[6A]**, **[6B]**, **[7+8]**.

### Stage 1: Foundation
Next.js + strict TS, Tailwind + shadcn/ui, design tokens, ESLint/Prettier, env validation, Docker Compose (Postgres 16), Drizzle config, Vitest + Playwright config, app shell (header, footer, 404), `.env.example`, initial README.
**Done when:** the app starts, `typecheck`, `lint` and a smoke test pass, and the DB container is reachable.

### Stage 2: Database
Full schema and migrations (extensions, constraints, indexes), unit registry, core services for brands/categories/products/variants/specifications with integration tests, idempotent seed.
**Done when:** migrations run on an empty DB, the seed runs twice without duplicates, and integration tests for CRUD, spec validation, unit conversion and unique constraints pass.

### Stage 3: Public catalog
Homepage, navigation, market selector, catalog, category pages with category-specific filters, brand pages, product detail pages with variants and spec tables, search + suggestions, static pages.
**Done when:** Journey A passes and filter queries are tested.

### Stage 4: Comparison
Compare tray, picker, comparison service (unit normalization, missing values, direction highlighting), canonical shareable URLs, responsive layout.
**Done when:** Journey B passes and unit tests cover the comparison service and URL canonicalization.

### Stage 5: Offers and affiliate
Offer display rules (fresh/stale/expired, market grouping), `/go/[offerId]`, click recording, price history writes, disclosures.
**Done when:** Journey C passes and unit tests cover redirect validation (including host allowlist rejection).

### Stage 6A: Admin core
Auth (login, logout, `admin:create` script, rate limiting), role checks, dashboard, CRUD for products, variants, specs, images, brands, categories, definitions, retailers, offers, sources; audit log.
**Done when:** Journey D passes and tests confirm that unauthenticated access to every admin route/action is rejected.

### Stage 6B: Imports and verification
CSV import/export workflow, duplicate detection, review queue, public correction form.
**Done when:** Journey E passes and import idempotency is tested.

### Stage 7: SEO and quality
Metadata, JSON-LD, indexability function, sitemap, robots, slug redirects, accessibility pass (axe in Playwright on key pages), performance review, security review against Section 13.

### Stage 8: Final verification and docs
Full test suite, migrations from scratch, mobile viewport e2e runs, all documentation (Section 19), final acceptance checklist (Section 18) with each item marked verified or not.

---

# 17. E2E JOURNEYS (PLAYWRIGHT)

Run against a seeded test database. Use desktop and one mobile viewport.

**A. Discovery:** homepage → search by model number → results → product page → spec table visible with the correct values.

**B. Comparison:** category page → add two products to compare → comparison shows both side by side → add a third → remove one → table and URL update; a missing spec shows "Not available".

**C. Retailer shopping:** product page with a fresh demo offer → offer shows retailer, price, currency, market, last checked → request `/go/[offerId]` with redirects disabled (Playwright `request` API) → assert 302 and that `Location` equals the configured demo URL → assert one `affiliate_clicks` row was added. Also assert that a tampered or unknown offer ID returns 404. Do not navigate to the external site.

**D. Administration:** log in (admin created in test setup) → create a product → add a variant → add specs → add a source → publish → public product page shows the data. Then log out and confirm admin URLs redirect to login.

**E. CSV import:** upload the sample CSV → preview → validation errors shown for malformed rows → a duplicate is detected → commit valid rows → download the error report → import the same file again → zero new records.

---

# 18. ACCEPTANCE CRITERIA

The MVP is complete only when each item is **verified**, not merely implemented:

- App starts locally; PostgreSQL connects; migrations run from scratch; seed runs repeatedly without duplicates.
- Public pages load; search (exact model number, fuzzy, brand) works; category-specific filtering works; product detail pages with variants work.
- Comparison works for 2–4 products, handles missing specs and normalizes units; URLs are canonical and shareable.
- Offers show only real or explicitly labeled demo data, with freshness and market; stale/expired rules hold.
- Affiliate redirects are safe (no open redirect) and record clicks.
- Admin authentication and server-side authorization work; product CRUD works; CSV import/export works and is idempotent.
- Source attribution and verification status are visible publicly.
- SEO metadata, JSON-LD, indexability rules and sitemap work; demo data is never indexed.
- Mobile layouts work.
- Tests, typecheck and lint pass.
- Documentation is complete.

---

# 19. DOCUMENTATION

- `README.md`: overview, stack, prerequisites, install, env vars, database setup, migrations, seed, creating the first admin, dev/test/build commands, deployment summary.
- `CLAUDE.md`: rules (Section 2) and commands, kept current.
- `docs/SPEC.md`: this document.
- `docs/PROGRESS.md`: stage status (Section 0.3).
- `docs/DECISIONS.md`: decision log.
- `docs/ARCHITECTURE.md`: structure, modules, data flows, product/variant model, search, affiliate, import architecture.
- `docs/DATA_MODEL.md`: every table, key fields, relationships, constraints (a Mermaid ER diagram is welcome).
- `docs/DATA_ACQUISITION.md`: CSV import, provider adapters, provenance, verification workflow, product matching, data-rights considerations.
- `docs/DEPLOYMENT.md`: hosting, managed Postgres, storage, env vars, migrations in CI/CD, backup and restore.
- `docs/ROADMAP.md`: deferred features.

---

# 20. SCOPE CONTROL

Build first: product database, catalog, detail pages, search and filters, comparison, offers, affiliate redirects, admin, CSV import, SEO foundation.

Do not build in the MVP (keep the architecture open for them): public accounts, user reviews and ratings, forums, subscriptions, mobile apps, AI recommendation engine, real-time price tracking, automated scraping, API billing, checkout, currency conversion, multi-language UI, price history charts.

Prioritize a working, secure, attractive, maintainable MVP that one founder can operate and extend with AI assistance over a broad collection of half-finished features.

---

# 21. START

Follow Section 0.1 now: inspect the repository, save this spec to `docs/SPEC.md`, create `CLAUDE.md`, write the plan, then implement Stages 1 and 2 and stop at the stage gate.
