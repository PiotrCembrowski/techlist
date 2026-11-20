# Decisions

One entry per non-obvious engineering decision: **decision**, **reason**, **alternatives**.

## 2026-11-19 — Stages 1–2

### D1. Design direction 1a "Drafting Sheet"

- **Decision:** Implement the 1a direction from the Claude Design Round 1 board (`design/project/`): Industry system, cool grey `#f2f2f3` ground, single steel accent (`#416180` light / `#94bce3` dark), Barlow + Barlow Condensed, square hairline frames with `+` registration marks.
- **Reason:** Chosen by the product owner.
- **Alternatives:** 1b Reference Index, 1c Instrument Panel (on the same board).

### D2. Tokens map to shadcn variable names

- **Decision:** `globals.css` defines the shadcn set (`--background`, `--primary`, `--ring`, …) plus `--success`, `--warning`, `--verified`, `--stale`, `--border-strong`, for `:root` and `.dark`, mapped to Tailwind via `@theme inline`. `--radius` is `0px`.
- **Reason:** The brief asks for shadcn-compatible tokens; square corners are central to the Industry system.
- **Alternatives:** Tailwind config tokens (Tailwind 4 prefers CSS-first config).

### D3. Self-hosted fonts via Fontsource

- **Decision:** `@fontsource/barlow` and `@fontsource/barlow-condensed`, imported in the root layout.
- **Reason:** Builds need no network access and visitors' browsers make no third-party font requests. Same OFL fonts as the design.
- **Alternatives:** `next/font/google` (downloads at build time).

### D4. TypeScript 5.9 instead of 7

- **Decision:** Pin `typescript@5.9.3`.
- **Reason:** TypeScript 7 (the native port) became `latest` recently; Next.js's build-time type checking relies on the TypeScript JS API, which 5.x provides.
- **Alternatives:** TS 7 once Next.js supports it.

### D5. PostgreSQL enums for every enumerated column

- **Decision:** Use `pgEnum` consistently (product/publication/verification status, data types, origins, source types, offer states, review types, roles, …).
- **Reason:** Spec §5.1 asks for consistency; enums give type safety in Drizzle and in the database.
- **Alternatives:** `text` + `CHECK` (easier to extend, but adding enum values is a cheap migration anyway).

### D6. Separate `spec_verification_status` enum: `unverified | verified | rejected`

- **Decision:** Specification values use their own status enum rather than the product-level one.
- **Reason:** Rule 2.1.8 uses the word `unverified`, which the product enum doesn't have; product-level states like `partially_verified` make no sense for a single value. A CHECK requires `last_verified_at` whenever a value is `verified`.
- **Alternatives:** Reuse the product enum.

### D7. Immutable `sb_unaccent()` wrapper

- **Decision:** Migration 0000 creates `sb_unaccent(text)`, an IMMUTABLE SQL function calling `public.unaccent('public.unaccent', $1)`. It is used in the `lower(sb_unaccent(name))` unique index on brands and in the search vector.
- **Reason:** `unaccent()` is only STABLE, so PostgreSQL refuses it in index expressions.
- **Alternatives:** A generated, unaccented name column.

### D8. Search vector maintained by a trigger

- **Decision:** `products.search_vector` is computed by a BEFORE INSERT/UPDATE trigger: name and model/part numbers (weight A); model name, aliases and brand name plus brand aliases (weight B). It uses the `simple` configuration with unaccent. Renaming a brand refreshes its products.
- **Reason:** A generated column cannot read the brand's name from another table. `simple` avoids language-specific stemming for a global catalogue.
- **Alternatives:** A denormalized `brand_name` column with a generated tsvector.

### D9. Region codes are two letters

- **Decision:** `product_variants.region_code` uses `^[A-Z]{2}$` (ISO alpha-2, plus ISO-reserved region codes such as `EU`); NULL means global.
- **Reason:** Simple, consistent with country codes, and covers the spec's `EU` example.
- **Alternatives:** A region table (worth it only if regions like `APAC` are needed; that would be a later migration).

### D10. Natural keys added for idempotent seed and imports

- **Decision:** Additional unique constraints: `product_variants (product_id, variant_code)`; `retailer_offers (retailer_id, product_id, variant_id, market_country_code, condition)` with NULLS NOT DISTINCT; `featured_comparisons.title`; `lower(sources.source_name)`; `product_source_records (product_id, variant_id, source_id)`; `product_links (product_id, link_type, url)`.
- **Reason:** Upserts need a natural key; these also stop accidental duplicates.
- **Alternatives:** Look-then-insert in application code (race-prone).

### D11. Seed upserts only rewrite changed rows; offer times are anchored to the hour

- **Decision:** The seed uses `INSERT … ON CONFLICT DO UPDATE … WHERE (cols) IS DISTINCT FROM (excluded cols)`. Offer `last_checked_at` and `expires_at` are relative to the start of the current UTC hour. Verification timestamps are fixed. `price_history` is written only when an offer is new or its price/currency changed.
- **Reason:** "Running twice changes nothing" — no new rows and no `updated_at` churn — while fresh, stale and expired offers stay testable as time passes. A re-seed in a later hour refreshes offer check times (and nothing else).
- **Alternatives:** Fixed absolute offer times (fresh offers would go stale permanently); `DO NOTHING` (seed data fixes would never apply).

### D12. The seed writes rows directly; it does not call the services

- **Decision:** The seed validates every record with the same Zod schemas and `parseSpecificationValue()` that the services use, then upserts directly.
- **Reason:** Going through the services would write an audit-log row on every run, which breaks idempotency. Audit logs are for human/admin changes.
- **Alternatives:** Services with a "no audit" flag (a flag that could be misused).

### D13. Partial updates keep only provided keys (`onlyProvided`)

- **Decision:** Update services parse with `schema.partial()`, then keep only the keys present in the input.
- **Reason:** In Zod 4, `.default()` inside `.partial()` still fills omitted fields, which would silently reset `isActive`, `aliases`, etc. Covered by tests.
- **Alternatives:** Separate update schemas without defaults (duplication).

### D14. Unit registry semantics

- **Decision:** Storage is decimal SI (1 TB = 1000 GB); binary units (GiB, TiB) are accepted with their exact factor. A bare number is taken to be in the canonical unit. Results are rounded to 12 significant digits to remove float noise. Number parsing accepts `5 000`, `5,000`, `1,39` and `1.234,5`. `mW`/`MW` both mean milliwatt (megawatts are not a hardware unit). Values are stored as `numeric`.
- **Reason:** Spec §5.2; predictable conversions for imports.
- **Alternatives:** A units library (heavier; most don't cover mAh, nits, MP or bit-width).

### D15. Spec-key uniqueness is enforced in the service, over ancestors and descendants

- **Decision:** Creating a definition (or group) checks the key against the whole chain: ancestors, the category itself and all descendants. Re-parenting a category checks that keys in the moved subtree don't clash with the new ancestors.
- **Reason:** Spec §5.2 ("unique within a category's full inheritance chain"). A per-category unique constraint is the database backstop.
- **Alternatives:** A trigger (harder to give clear errors).

### D16. Verified values are protected even against equal-confidence imports

- **Decision:** `setSpecificationValue()` never overwrites a `verified` value with anything that isn't explicitly verified by a human. It creates a `conflicting_value` review item instead. `ai_extracted` values are forced to `unverified` and always queued as `unverified_spec`.
- **Reason:** Rules 2.1.7 and 2.1.8.
- **Alternatives:** Confidence thresholds (a human still has to decide).

### D17. Cascades

- **Decision:** Product-owned rows (variants, specs, images, links, source records, relationships, offers, price history, clicks, guide links) cascade on product delete. Brand, category and retailer references are `RESTRICT`.
- **Reason:** Hard delete is only allowed for drafts (§5.2), and removing a draft should remove what hangs off it. Shared reference data must never disappear by accident.
- **Alternatives:** Restrict everything (drafts with offers couldn't be deleted).

### D18. Local verification on native PostgreSQL 16

- **Decision:** `docker-compose.yml` provides `postgres:16-alpine` for development. In the build session, Docker Hub rate-limited the image pull (HTTP 429), so migrations, integration tests and e2e ran on a native PostgreSQL 16.15 install with the same role and databases.
- **Reason:** It is real PostgreSQL 16; no substitutes were used (§0.4).
- **Alternatives:** —

### D19. Header shows only implemented navigation

- **Decision:** In Stages 1–2 the header has the wordmark and the theme toggle only. Categories, Brands, Compare, Guides, search and the market selector arrive in Stage 3 with their routes. The homepage hero shows live catalogue counts from the database.
- **Reason:** Rule 2.3.1 forbids links that look functional but lead nowhere; rule 2.3.2 forbids faked sections.
- **Alternatives:** "Coming soon" labels (unnecessary noise on a page this small).

### D20. `SITE_URL` defaults to localhost

- **Decision:** `SITE_URL` is optional with a localhost default, even with `NODE_ENV=production`.
- **Reason:** `next build`/`next start` always run as production, including local and e2e builds. Deployments must set it (documented).
- **Alternatives:** Fail when unset in production (broke local production builds).

### D21. e2e runs against a production build on the seeded test database

- **Decision:** Playwright's global setup resets, migrates and seeds `TEST_DATABASE_URL`; `webServer` runs `pnpm build && pnpm start` with that database. Two projects: desktop (1440×900) and mobile (Pixel 7). `@playwright/test` is pinned to 1.63.0 to match the preinstalled Chromium.
- **Reason:** Spec §17 ("against a seeded test database"; desktop + one mobile viewport).
- **Alternatives:** Running against `next dev` (slower and less representative).

### D22. Design handoff kept in `design/`

- **Decision:** The Claude Design export (board, design-system CSS, chat transcript) lives in `design/`, excluded from TypeScript, lint and formatting.
- **Reason:** Reference for later stages (cards, PDP, offers table are already drawn there).
- **Alternatives:** Discard it.

## 2026-11-19 — Stage 3

### D23. Permanent redirects use 308, not 301

- **Decision:** Wrong brand slugs and renamed products/categories/brands/guides redirect with Next.js `permanentRedirect()`, which answers **308**.
- **Reason:** 308 is the permanent redirect that preserves the request method; search engines treat it the same as 301. Producing a literal 301 from a page in Next.js 16 would need a proxy/middleware layer just for this.
- **Alternatives:** A `proxy.ts` that rewrites to 301 (revisit in Stage 7 if an SEO tool insists).

### D24. Spec filters match product-level **or** variant-level values

- **Decision:** A filter such as `s.storage.min=1000` matches a product if the product value or any variant value matches ("available with ≥ 1 TB").
- **Reason:** Variants are configurations of one product; hiding the Aera 7 Pro from a "≥ 1 TB" filter because its default is 256 GB would be wrong.
- **Alternatives:** Product-level only (misses configurations); listing variants as separate cards (rule 2.1.5 keeps products and variants separate).

### D25. Filter URL format

- **Decision:** `s.<key>.min` / `s.<key>.max` (numeric, canonical unit), repeated `s.<key>=<option>` (enum/multi-select, any-of), `s.<key>=yes|no` (boolean); plus `q`, `brand` (repeatable), `status`, `sort`, `page`, `price.min/max`. Only **filterable** definitions of the page's category (including inherited) are honoured; everything else is ignored. GET forms that submit empty fields redirect to the clean canonical query string. Filtered listings are `noindex, follow` with a canonical to the unfiltered page.
- **Reason:** Readable, shareable URLs; filters work without JavaScript; no GPU filters on headphone pages by construction.
- **Alternatives:** Encoded JSON in one param (unreadable).

### D26. Price filter / price sort only for a single-currency market

- **Decision:** Shown only when the selected market's displayable offers use exactly one currency (derived from data, not a hard-coded country→currency table). Price = lowest **fresh, in-stock** offer in that market. For "All markets", cards show offer and market counts but never a price.
- **Reason:** SPEC §6 — prices in different currencies can't be compared without conversion.
- **Alternatives:** A static currency map per country (wrong for multi-currency markets).

### D27. Prices are displayed with the ISO currency code

- **Decision:** `PLN 3,899.00`, `USD 699.99` (`Intl.NumberFormat`, `currencyDisplay: "code"`, en-GB).
- **Reason:** "$" is ambiguous across markets; the original currency must be unmistakable.
- **Alternatives:** Localised symbols ("3 899,00 zł" as on the design board) once the UI is localised.

### D28. Storage values ≥ 1000 GB display as TB

- **Decision:** Display-only rescaling for whole multiples of 1000 GB ("1 TB"). Stored and compared values stay in GB.
- **Reason:** "1,000 GB" reads badly; storage stays decimal SI (D14).

### D29. Search: thresholds and ranking

- **Decision:** `PostgresSearchService` ranks exact model number / MPN / variant GTIN / variant MPN first, then `ts_rank` of a prefix tsquery built only from `[a-z0-9]` tokens (no operator injection), then trigram `word_similarity` ≥ 0.35 over name and "brand + name". Brands and categories are separate groups; "did you mean" uses word similarity ≥ 0.25 when nothing matched. Suggestions: max 8 products, 3 brands, 3 categories, minimum 2 characters, 200 ms client debounce.
- **Reason:** 0.4 missed one-letter typos in short names ("aeara" → "Aera" scores 0.375).
- **Alternatives:** `pg_trgm` operators with index support (`%`, `<%`) — better at scale; revisit with `EXPLAIN` in Stage 7.

### D30. Postgres rate limiter implemented in Stage 3

- **Decision:** `PostgresRateLimiter` (fixed window, atomic upsert into `rate_limits`, behind a `RateLimiter` interface) ships now for `/api/search/suggest` (60 requests/min per client). Keys hash the client address (SHA-256); rows are pruned after a day.
- **Reason:** SPEC §13 rate-limits search suggestions, which ship in this stage. Stage 6A reuses it for login.
- **Alternatives:** No limit until 6A.

### D31. Pages render dynamically per request

- **Decision:** Public pages read the `market` cookie (header, cards), so they render per request. No ISR yet.
- **Reason:** Correct market-specific prices first. ISR with on-demand revalidation (SPEC §14) needs a market-independent shell; that's a Stage 7 performance task.
- **Alternatives:** Client-side price islands (more JS).

### D32. Stage 3 scope boundaries

- **Decision:** Not shown yet, because the routes they link to arrive later (rule 2.3.1): the header **Compare** link and card compare toggles (Stage 4 — done), the homepage **featured comparisons** section (Stage 4 — done), the PDP **offer list** with `/go/` links (Stage 5), and **Suggest a correction** (Stage 6B). Product images: always the placeholder until uploads exist (Stage 6A). The brand page "featured comparisons involving the brand" section also arrives in Stage 4 (done).
- **Reason:** No controls that look functional but do nothing.

### D33. Single root layout; no `(public)` route group yet

- **Decision:** Public routes live directly under `src/app/`. The `(public)` group from SPEC §4 is introduced in Stage 6A, when the admin needs a different layout.
- **Reason:** Avoids an empty abstraction; moving files into a route group doesn't change URLs.

## 2026-11-20 — Stage 4

### D34. Comparison rows come from the deepest common category

- **Decision:** For 2–4 products sharing a top-level category, rows are the comparable, public definitions of their **lowest common category** (inherited ones included). A laptop + a gaming laptop compare on laptop rows; two gaming laptops also get the GPU rows. Different top-level categories get a clear "can't be compared" page with links to compare within each group.
- **Reason:** SPEC §7.7 ("comparable definitions of the shared category, including inherited ones").
- **Alternatives:** The union of all definitions (would show rows that cannot apply to some products).

### D35. Difference and "better" semantics

- **Decision:** A row **differs** when known values differ, or when some products have a value and others don't. The **better** marker (icon + "Highest"/"Lowest" text) appears only for definitions with a comparison direction and only when at least two known values differ; ties and single values get no marker. There is no overall score. Rows where no product has a value are omitted. "Show only differences" hides identical rows with CSS (no refetch, no extra URLs).
- **Reason:** SPEC §7.7, and status is never conveyed by colour alone.
- **Alternatives:** Treating missing as "worse" (would reward incomplete data entry).

### D36. Manufacturer claims

- **Decision:** A value whose source has `source_type = manufacturer` is labelled "manufacturer claim". There is no "independent measurement" source type yet, so other values carry no extra label.
- **Reason:** SPEC §7.7 asks to distinguish claims from measurements "when the source type indicates it".

### D37. Tray in localStorage via `useSyncExternalStore`; URL is the source of truth on comparison pages

- **Decision:** The tray (max 4) is a small external store over `localStorage` (try/catch everywhere; falls back to memory for the page view; validated with Zod on read; synced across tabs). Products from another top-level category are not silently added: the tray asks whether to start a new comparison. Opening a comparison URL (including a shared link) replaces the tray with that comparison's products. Removing a product navigates to the new canonical URL and updates the tray. `/compare` shows the picker and the current tray and moves to the comparison once two products are chosen.
- **Reason:** SPEC §7.7; shareable URLs stay authoritative.
- **Alternatives:** Server-side session state (needs cookies/accounts, out of scope).

### D38. Comparison table layout

- **Decision:** One `<table>` inside a scroll container (`max-h-[80vh]`, scrolls both ways) with a sticky header row (products, remove buttons, "Add product" slot) and a sticky first column (spec labels). The same layout serves mobile: labels stay visible while products scroll horizontally.
- **Reason:** SPEC §7.7 mobile requirement; one accessible table instead of a separate stacked layout.
- **Alternatives:** Stacked per-spec cards on mobile (more markup; harder to scan across products).

### D39. Comparison picker endpoint

- **Decision:** `/api/compare/search?q=&category=` reuses the catalogue query (name, model number, fuzzy) scoped to one category tree, ≤ 8 results, rate-limited (60/min per hashed client).
- **Reason:** "Add product" must offer only products that can be compared.
