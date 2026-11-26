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

### D23. Permanent redirects use 308, not 301 (superseded by D67)

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

### D31. Pages render dynamically per request (see D70)

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

## 2026-11-20 — Stage 5

### D40. Offer ordering and grouping

- **Decision:** Within a market: in stock → pre-order → unknown → out of stock, then currency, then price, then retailer name. The selected market comes first; other markets are grouped under a collapsed "Other markets" `<details>`, each with its market labelled. With "All markets", every market is its own group and nothing is collapsed. Stale offers (older than `OFFER_STALE_HOURS`) follow fresh ones in each market, under a "price last checked N days ago, may have changed" warning, with a "Check price" link. Expired/inactive offers and offers from inactive retailers are never shown.
- **Reason:** SPEC §5.2/§7.6. Buyable offers first is more useful than a cheap out-of-stock listing; amounts in different currencies are never ranked against each other. The affiliate disclosure says exactly this.
- **Alternatives:** Pure price order (puts unbuyable offers on top).

### D41. Variant-specific offers

- **Decision:** With `?variant=`, the page shows that variant's offers plus offers not tied to any variant; without it, all offers, each labelled with its variant.
- **Reason:** SPEC §7.6 item 6 (offers update with the variant) without hiding offers on the default view.

### D42. `/go/[offerId]` details

- **Decision:** Route handler: UUID check → offer active, unexpired, retailer active, product published, demo only with `ENABLE_DEMO_DATA` → target = `affiliate_url ?? product_url`, which must be `https`, without credentials or a non-443 port, and whose hostname must match an `allowed_redirect_hosts` entry exactly (case-insensitive, trailing dot ignored; **no** subdomain or suffix matching). Any refusal is a plain 404; misconfigured hosts/URLs also log a structured warning with the offer id only. Success: insert `affiliate_clicks` (market from cookie if valid, referrer **host** only, UA-keyword bot flag; no IP/UA stored) then `302` with `Cache-Control: no-store`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Robots-Tag: noindex, nofollow`. `HEAD` returns 405 so link checkers and previews never count as clicks. Links are plain `<a rel="sponsored nofollow noopener" target="_blank">` (no prefetch).
- **Reason:** SPEC §11; no open redirect is possible because nothing from the request is used as a target.
- **Alternatives:** Wildcard host patterns (too easy to misconfigure into an open redirect).

### D43. Offer write rules enforced at write time too

- **Decision:** `createRetailerOffer` / `updateRetailerOffer` validate currency ∈ retailer's supported currencies, variant ∈ product, and that `product_url` / `affiliate_url` would pass the redirect validation. Price history is appended (never updated) on creation and on every price or currency change; "mark as checked now" doesn't add history. Money is normalised to `numeric(14,4)` strings.
- **Reason:** Catch bad data when it is entered rather than as a 404 at click time.

### D44. Suspicious prices

- **Decision:** On create and on price change, if the price deviates more than `SUSPICIOUS_PRICE_DEVIATION` (env, default 0.5 = 50%) from the median of the product's other fresh, active offers in the same currency, a `suspicious_price` review item is created. The offer is still saved (an admin decides in the review queue, Stage 6B).
- **Reason:** SPEC §5.2 review_items. Blocking the write would lose legitimate clearance prices.

### D45. robots.ts added in Stage 5

- **Decision:** `robots.txt` (disallow `/admin`, `/api`, `/go`, `/search`) ships now because `/go/` exists; the sitemap and indexability rules remain Stage 7.

### D46. Auth.js v5 credentials with JWT sessions, re-checked in the database

- **Decision:** Auth.js (`next-auth@5` beta) with the Credentials provider only, argon2id hashes (`@node-rs/argon2`), JWT session cookie (HTTP-only, SameSite=Lax, Secure on https, 8 h). Every admin page, Server Action and route handler calls `requireAdmin()`, which re-loads the user and requires `is_active`. No registration and no default credentials; the first owner comes from `pnpm admin:create` (password from a hidden prompt or stdin, never an argument). Unknown emails run a dummy hash so timing does not reveal which accounts exist.
- **Reason:** SPEC §9/§13. JWT sessions need no session table, and the database re-check makes deactivation take effect on the very next request.
- **Alternatives:** Database sessions (an extra table and adapter for no gain here); a custom session cookie (more security-sensitive code to own).

### D47. Authorization lives in the action wrapper, not in middleware

- **Decision:** `adminAction(handler, { role })` runs `requireAdmin` before the handler on every call. The admin layout also calls it, and so does every page (layouts don't run for Server Action POSTs). There is no `middleware.ts` auth gate. Owner-only actions (user management) pass `role: "owner"`. An integration test imports every `actions.ts` under `src/app/admin` (except the login action) and asserts that each export redirects to `/admin/login` with no session, and to `?reason=inactive` for deleted or deactivated users, with no audit rows written.
- **Reason:** Server Actions are public POST endpoints; checking inside each one is the only check that cannot be bypassed by calling the action directly. The discovery-based test fails if a new action module is added without the wrapper.

### D48. Login rate limit counts every attempt

- **Decision:** `checkCredentials()` consumes the Postgres rate limiter (5 per 15 min, key = hash of client address + email) **before** verifying the password, so correct and incorrect attempts count alike. A limited attempt shows "Too many sign-in attempts"; any other failure shows one generic message.
- **Reason:** SPEC §13. Counting before verifying stops the limiter from revealing which passwords are correct.

### D49. Admin routes in `app/admin`, public pages in the `(public)` route group

- **Decision:** Public pages moved into `src/app/(public)/` with their own layout (header, footer, demo banner, compare tray). The admin has a separate shell (`admin/(panel)/layout.tsx`) and `/admin/login` stands alone. `/admin/*` responses carry `X-Frame-Options: DENY`, `frame-ancestors 'none'` and `X-Robots-Tag: noindex, nofollow`; the metadata is `noindex`.
- **Reason:** The public chrome (compare tray, market selector) does not belong in the admin; route groups keep URLs unchanged.

### D50. Uploaded files only, behind a storage driver

- **Decision:** `StorageDriver` with `local` (default, `STORAGE_LOCAL_DIR`) and `s3` (any S3-compatible service; SDK loaded lazily) drivers. Keys are generated (`products|brands/<uuid>.<ext>`) and validated on every operation; local writes never overwrite. Uploads must be ≤ 5 MB, and the magic bytes must say JPEG, PNG or WebP and agree with the declared MIME type. SVG is refused (XSS). Files are served by `/media/[...key]` with `nosniff`, `default-src 'none'` and immutable caching. Product images require alt text and a licence note; hotlinking is not possible because images have no URL field.
- **Reason:** SPEC §13 and rule 2.1.9.

### D51. Which images are public

- **Decision:** An image is shown publicly (product gallery, card thumbnail) only when it has no source or its source has `usage_permitted = true`. Cards show the product-level primary image; the product page shows product images plus the selected variant's. Brand logos replace the monogram plate when uploaded.
- **Reason:** Rule 2.1.9: we never assume redistribution rights, even after an upload.

### D52. Admin forms

- **Decision:** Plain Server Action forms with one small client wrapper (`ActionForm`) that submits through `useActionState` but prevents React 19's automatic form reset, so typed values survive validation errors. Field errors come from `ValidationError.issues` (path → message). Hints are linked with `aria-describedby`, so accessible names stay short, and the required asterisk is `aria-hidden` (the `required` attribute is announced). Destructive actions ask for confirmation and are re-validated on the server.
- **Reason:** Accessible, no client state library, works with the service layer as-is.

### D53. Specification editor semantics

- **Decision:** One form per scope (product, or one variant's overrides). Non-empty fields go through `setSpecificationValue` (unit parsing → canonical unit). Emptying a field that had a value clears it. "Mark verified" applies only to values changed in this save, together with the chosen source. A verified value is never overwritten by unverified input: a review item is created instead, and the save message says so. A definition's type and unit cannot change once values exist.
- **Reason:** Rules 2.1.6–2.1.8.

### D54. Admin e2e runs after the public e2e

- **Decision:** Journey D runs in `admin-desktop` / `admin-mobile` Playwright projects that depend on the public projects. The e2e admin is created in global setup with a test-only password from `tests/e2e/fixtures.ts`.
- **Reason:** Journey D publishes a product; the public specs assert exact counts against the seed.

### D55. Import pipeline: stage, plan, commit

- **Decision:** Upload stores every raw row in `import_rows` and auto-maps headers (case/space-insensitive, a few aliases, `spec.<key>`). "Validate" runs one planning pass over all rows with bulk lookups (brands, categories, sources, GTIN/MPN/model matches, name similarity, earlier review decisions, existing variants/specs/source records in a fixed number of queries; no per-row queries) and writes each row's action, problems and notes. "Commit" plans again (the catalogue may have changed), then applies create/update rows through the normal services in transactions of 100 rows with one savepoint per row, so a failing row is reported without undoing the others. A job is claimed (`started_at`) so it cannot be committed twice. Conflicts become review items at commit time, not during the preview.
- **Reason:** SPEC §9.6. Going through the services keeps validation, audit logging and verified-value protection identical to manual edits.

### D56. Duplicate detection and variant identity

- **Decision:** Product match order: exact GTIN → brand + MPN (product or variant) → brand + normalised model number (case and punctuation ignored) → name trigram similarity ≥ 0.6 within the brand. The first three are matches; similarity alone is only a `duplicate_candidate` conflict. Identifiers that point at different products, another brand's GTIN or a matched product in another category are errors. Variant match: GTIN → code (given or derived from the name) → name. A matched variant whose region differs from the row's (when the file has a `region_code` column) is a `variant_ambiguity` conflict; regional variants are never merged (rule 2.1.5). Brands, categories and sources must already exist; imports never create them.
- **Reason:** SPEC §9.6 step 6; creating brands from typos would pollute the catalogue.

### D57. Idempotency means "compare with the catalogue", not only row hashes

- **Decision:** A row is `skip` when applying it would change nothing: provided fields equal the stored ones, specification values equal the variant's effective value (override or product value), and the product-level source record exists. Empty cells never clear stored values. `row_hash` (SHA-256 of the mapped, trimmed cells) is stored and used to detect repeated rows within a file and to find earlier review decisions for the same row (approved: use the product/variant the reviewer chose or created; rejected: skip; open: conflict without a new item). Re-proposing a value that is already waiting as a `conflicting_value` item does not open a second one.
- **Reason:** Hashes alone miss changes made in the admin between imports; comparing state makes "re-import the same file → zero new records" hold in every case.

### D58. Where imported specification values go

- **Decision:** Products are imported one row per variant. For each specification, if every variant of the product (existing and new) gets the same value from the file and no existing override would keep shadowing it, the value is written once at product level; otherwise each row writes its variant's own override. Imported values are `origin = import`, `unverified`, with the row's source. Exports write each variant's effective value with its canonical unit ("1000 GB"), so export → import is a no-op.
- **Reason:** Keeps product-level data where it belongs without silently overwriting other variants.

### D59. CSV format and formula injection

- **Decision:** A small RFC 4180 parser/writer in `src/lib/csv` (no dependency): strict UTF-8 (a BOM is ignored), quoted fields, CRLF output. Uploads must end in `.csv`, contain no NUL bytes, be ≤ 5 MB and ≤ 10,000 data rows, with unique non-empty headers. Exported cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'`; the importer strips that prefix again, so round trips are lossless. Products and offers templates/exports include an extra `is_demo` column so fictional sample data stays labelled (rule 2.1.2). Imports are limited to 20 uploads per admin per hour.
- **Reason:** SPEC §9.6 and §13.

### D60. Review queue resolutions

- **Decision:** Approve/reject run in one transaction with the change they cause and an audit entry; reject needs a note. Per type — conflicting value: approve applies the proposed (or edited) value and marks it verified, reject keeps the verified value. Unverified (AI) value: approve verifies (optionally edited), reject deletes it. Suspicious price: approve changes nothing, reject deactivates the offer. New product (from import): approve publishes the draft, reject archives it. Duplicate candidate: the reviewer picks "same as <candidate>" (the row updates that product) or "different product" (created as a draft); variant ambiguity: "same variant" or "separate variant" (created with a region-suffixed code). The decision is stored in the item so re-imports follow it. Reader correction: approve applies the value with the source "Reader corrections (reviewed)"; replacing a verified value requires ticking "verified". Personal data (the optional email) is removed from an item when it is resolved.
- **Reason:** SPEC §9.7; rules 2.1.6–2.1.8.

### D61. Public correction form

- **Decision:** `/products/<brand>/<product>/suggest-correction` (noindex): optional specification (public definitions of the product's category), value, source URL (required, http/https), optional email, a visually hidden honeypot field. A Server Action (origin-checked by Next.js) calls `submitCorrection`, which validates with Zod, limits 5 submissions per address per hour (hashed key) and stores a `correction` review item with no `created_by`. A filled honeypot gets the normal "thank you" and stores nothing. Only published products accept corrections.
- **Reason:** SPEC §9.7 and §13.

### D62. Data provider adapters

- **Decision:** `ProductDataProvider` as in SPEC §10. `CsvProductProvider` reuses the import's row parsing. Manufacturer files, licensed feed and affiliate feed adapters are stubs: `isConfigured()` reports whether their environment settings exist (injectable for tests); `fetchProducts()` always refuses without any network call, because no provider agreement or implementation exists. The admin "Data providers" page shows their status with no controls. AI extraction is only the existing hook (`origin = ai_extracted` → unverified + review item).
- **Reason:** Rule 2.1.10 and SPEC §10.

### D63. Rate-limiter pruning uses the limiter's clock

- **Decision:** The 1 % chance cleanup deletes windows older than one day **relative to the limiter's own clock**, not the database's `now()`.
- **Reason:** With an injected clock in the past, the cleanup could delete the window being counted. This caused the rare integration-test failure seen in Stage 6A; a regression test now forces the cleanup.

## 2026-11-20 — Stage 7

### D64. One indexability function, mirrored once in SQL

- **Decision:** `getIndexability(page)` (`src/modules/seo/indexability.ts`) decides every page kind: product (published, not demo, active brand, `verified`/`partially_verified`, ≥ 60 % of the category's required specifications — inherited ones included — with a **product-level** value), category (active, unfiltered, ≥ 1 indexable product in its subtree), brand (active, not demo, ≥ 1 indexable product), comparison (canonical order and every product indexable), guide (published, not demo), listing (unfiltered, not empty), content pages (indexable) and utility pages (search, comparison picker, correction form, 404: `noindex, follow`). Demo and unpublished pages are also `nofollow`. The product rule is mirrored once in SQL (`sb_indexable_products()` + view `indexable_products`), used for the sitemap and the category/brand/comparison checks; an integration test compares the two product by product. While `ENABLE_DEMO_DATA` is on, every page is `noindex, nofollow`, the sitemap is empty and no structured data is emitted except the homepage's Organization/WebSite.
- **Reason:** SPEC §12 ("one function, unit-tested") and rule 2.1.2.

### D65. Metadata helper

- **Decision:** `pageMetadata()` sets title, description (≤ 300 chars), canonical, robots (from the indexability result), Open Graph and Twitter cards on every public page. Filtered and paginated listings are `noindex, follow` with the unfiltered page as canonical; product variants share the product's canonical URL.
- **Reason:** Unique, consistent metadata without per-page boilerplate.

### D66. Structured data

- **Decision:** JSON-LD via one server component (`JsonLd`), serialized with `<`, `>`, `&`, U+2028 and U+2029 escaped and carrying the CSP nonce — the only `dangerouslySetInnerHTML` (scoped lint exception). Homepage: Organization + WebSite with SearchAction. Indexable pages: BreadcrumbList; Product (name, brand, model, MPN, release date, category, primary image, key specifications as `additionalProperty`) on indexable products; Article on guides. `Offer` entries only for fresh, non-demo offers in the visitor's selected market — none when "All markets" is selected. Never Review or AggregateRating (tested).
- **Reason:** SPEC §12. An offer without a specific market cannot be "in-market".

### D67. 301 redirects in the proxy

- **Decision:** `src/proxy.ts` (Next 16's Node.js proxy) answers **301** for renamed product/brand/category/guide slugs (`slug_redirects`), wrong brand segments in product URLs, and non-canonical comparison orders, keeping the query string. It runs one indexed lookup only for those path prefixes. The pages keep their own `permanentRedirect` (308) as a fallback.
- **Reason:** SPEC §12 asks for 301s; D23 deferred this. A lookup per detail-page request is cheap next to the page's own queries.

### D68. Content Security Policy and headers

- **Decision:** The proxy creates a fresh nonce per page request and sends `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` (+ `upgrade-insecure-requests` and HSTS when `SITE_URL` is https; `'unsafe-eval'` in development only). The nonce reaches Next.js's scripts, the theme script (next-themes) and JSON-LD. `next.config.ts` adds `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy` and a restrictive `Permissions-Policy` everywhere, and `X-Robots-Tag: noindex` on the admin. Inline style attributes stay allowed (they cannot execute code; several components set sizes inline).
- **Reason:** SPEC §13. An e2e test exercises interactive pages and asserts no CSP violations.

### D69. Client addresses for rate limiting

- **Decision:** `TRUSTED_PROXY_HOPS` (default 1): the client address is the `X-Forwarded-For` entry that many hops from the **end** (what our own proxy appended), not the first entry (which the client controls). `0` ignores the header (one shared bucket). Addresses are only ever used hashed.
- **Reason:** Taking the first entry let clients choose their own rate-limit bucket. Documented as a deployment setting.

### D70. No ISR

- **Decision:** Pages stay dynamically rendered. Every page now needs a per-request CSP nonce, and prices depend on the market cookie. Instead, the queries were measured and fixed (`docs/PERFORMANCE.md`).
- **Reason:** SPEC §14 performance goals are met without static generation; a nonce CSP requires dynamic rendering.

### D71. Search candidates from indexes

- **Decision:** See `docs/PERFORMANCE.md`: candidates from identifier B-trees, the full-text index and a trigram index on the new `products.search_text` column (brand + name, lowercased and unaccented, maintained by the search trigger); scoring unchanged. Trigram operator thresholds are set per transaction (`set_config(..., true)`) to the search cut-off.
- **Reason:** Search was 240–960 ms at 20,000 products; now 15–30 ms.

### D72. Accessibility checks

- **Decision:** axe (`@axe-core/playwright`, WCAG 2.1 A/AA) runs in e2e on 14 public pages in light and dark mode and on 9 admin screens; the build fails on any violation. Links inside running text are underlined (they were distinguished by colour only).
- **Reason:** SPEC rule 2.3.4 and Stage 7.

## 2026-11-20 — Stage 8

### D73. Abandoned import commits can be resumed

- **Decision:** A commit claims its job (`started_at`) and refreshes the claim after every batch of 100 rows. A claim older than 15 minutes (`STALE_COMMIT_MINUTES`) counts as abandoned — e.g. the host killed a long request — and can be taken over by a new commit, or the import can be cancelled. Resuming is safe because the commit re-plans every row: rows already applied become `skip`/`update`.
- **Reason:** Committing 10,000 new products takes minutes (`docs/PERFORMANCE.md`), longer than many hosts allow per request; before this, a killed request left the job locked for good.
- **Alternatives:** Background job runner — the better long-term answer (`docs/ROADMAP.md`), but a new moving part.

### D74. Import duplicate detection uses the trigram index

- **Decision:** The name-similarity step joins rows to products with `name % row_name` (GIN trigram index, threshold set to the same 0.6 for the transaction) instead of computing similarity for every row × product pair of the brand. A quadratic lookup in the final planning pass was replaced by a set.
- **Reason:** Previewing 10,000 new rows took ~29 s. Measured effect is modest (~24 s): with the benchmark's heavily overlapping names, each index probe still returns many candidates (`docs/PERFORMANCE.md`). The check itself is required (SPEC §9.6), so it stays.

### D75. CI workflow

- **Decision:** `.github/workflows/ci.yml` runs the stage gate on every push to `main` and every pull request: typecheck, lint, formatting, migrations from scratch, seed twice (the second must change nothing), unit, integration and e2e tests against a PostgreSQL 16 service, with test-only secrets.
- **Reason:** SPEC §19 (migrations in CI/CD). Not run in this environment (no GitHub Actions runner here).

### D76. `DATA_SOURCES.md` became `DATA_ACQUISITION.md`

- **Decision:** The Stage 6B provider document was renamed and extended to the SPEC §19 scope (CSV import, matching, provenance, verification workflow, adapters, data rights).

## 2026-11-25 — Product import system, Stage 2

### D77. One status for products and variants

- **Decision:** `products.publication_status` + `products.verification_status` and `product_variants.is_active` are replaced by one `status` (`catalog_status`): `draft → needs_review → verified → published`, plus `rejected` and `archived`. Allowed changes are in `src/modules/products/status.ts`; publishing straight from draft/needs_review is "verify & publish" and stamps `last_verified_at`; unpublishing goes back to `verified`; archived/rejected can be restored to draft; only draft or rejected products can be hard-deleted. Indexable = published, not demo, active brand, ≥ 60 % core specs (published implies verified). The public badge shows "Verified · date" when `last_verified_at` is set and "Not verified yet" otherwise. Migration 0006 backfills (archived → archived, published → published, otherwise rejected/verified/needs_review (incl. partially_verified)/draft from the old verification; variants: active → published, inactive → archived); 0007 drops the old columns. Guides keep `publication_status`.
- **Reason:** Product owner's choice for the import system ("just one status"); imported products need a review state before publication, and two independent fields allowed contradictory combinations (published + rejected). Supersedes SPEC §5.2 and the indexability rule in SPEC §12.
- **Alternatives:** Keep both fields and add a review flag (more states to reason about); derive one from the other (still two columns).
- **Deployment note:** 0007 drops columns, so the previous app version stops working once it runs. Deploy the new version together with the migration (DEPLOYMENT.md).

### D78. Import system foundation: adapters, ledger, cache, identifiers, provenance

- **Decision:** Provider adapters implement one contract (`src/modules/providers/core/types.ts`) that declares capabilities, licence (store vs cross-check only), quota rules, allowed API hosts and request spacing; they return records and never write to the catalogue. All provider traffic goes through one HTTP client (host allow-list, no redirects, timeouts, backoff with full jitter, Retry-After, body cap, redacted logs). Quotas are a database ledger (`provider_quota_usage`) reserved before every attempt with one conditional upsert per rule, all rules in one transaction. Raw responses are cached by a credential-free request hash. New tables: `product_identifiers` (GTIN-14 unique catalogue-wide, provider IDs unique per provider), `field_provenance`, `provider_settings`, `provider_quota_usage`, `provider_response_cache`, `provider_mappings`, `import_job_items`; `import_jobs` gains provider-job columns and a worker lease; `product_images` can hold an https `remote_url` with author/licence and a `rights_status`; review types `field_conflict` and `image_rights`.
- **Reason:** The import prompt's requirements (quota blocking before a limit, health and enable switches, raw cache, field-level provenance, never-overwrite verified values, image licensing and SSRF protection). A database ledger works across processes and the scheduled GitHub Actions worker; an in-memory counter would not.
- **Alternatives:** pg-boss / graphile-worker for jobs (owner chose own tables with `FOR UPDATE SKIP LOCKED`, Stage 9); a Redis rate limiter (another service).
- **Details:** `import_status` gains `queued` and `running` (provider jobs finish as `committed`). Partial indexes on active jobs are written as `status NOT IN (<older values>)` because Postgres refuses a newly added enum value in the same transaction and an enum→text cast is not immutable. Remote image hosts start empty (`REMOTE_IMAGE_HOSTS`) until each provider's documented host is verified.

## 2026-11-25 — Product import system, Stage 3

### D79. Normalisation, matching and provenance rules for provider imports

- **Decision:** Provider records are normalised into one model that keeps every raw value (`src/modules/import-core/normalize.ts`); GTINs are stored as GTIN-14; units are converted only when unambiguous (a bare number needs a documented unit on the mapping). Matching runs provider ID → GTIN (with a variant-attribute consistency check) → MPN + brand → model number + brand; name and fuzzy matches only create `duplicate_candidate` review items with confidence and reason. Unknown brands and unmapped categories block a record instead of creating anything. A provider may write a field only when it is empty or was supplied by the same source on a product that is not verified/published; manual, verified, provenance-less and higher-confidence values are protected (review item or non-current provenance). Admin edits record manual provenance in the product and variant services. Each record is applied in one transaction under an advisory lock; unchanged payload hashes only update `last_seen_at`. The six target categories and their definitions live in `catalog-config.ts` and are created by `pnpm catalog:bootstrap`, which never alters existing definitions.
- **Reason:** The import brief's identity rules ("never merge automatically on similar names", "never overwrite admin-verified data or lower confidence") and its requirement that every value trace to a source.
- **Alternatives:** A separate `duplicate_candidates` table (the existing review queue already stores candidates, confidence and reason, and has the approve/reject workflow); creating unknown brands automatically (risks duplicate brands from spelling variants); treating provenance-less values as overwritable (would let the first import overwrite hand-entered and CSV data).
- **Details:** Migration 0009 lets `field_provenance` record manual values (`is_manual`, `admin_user_id`, no source) and keeps `raw_record` and `unmapped_features` on source records. Specification values from imports store `raw_value` / `raw_unit`. Text fields with provider-specific vocabularies (OS, panel type, memory type) are text rather than option lists so real values are not rejected.

## 2026-11-26 — Product import system, Stages 8–9

### D80. Provider jobs, worker and Import Center

- **Decision:** Provider jobs are rows in `import_jobs` (`kind = provider`) with one `import_job_items` row per GTIN / provider ID (search jobs discover their items on the first run, checkpointed). Workers claim jobs with `FOR UPDATE SKIP LOCKED` and a renewable 5-minute lease; items run in batches, one transaction each; quota exhaustion or a long Retry-After puts the job back in the queue until the reset; time budgets pause jobs; cancel is honoured between items; only failed items are retried. Identical jobs are deduplicated by a partial unique index on active jobs. Preview (dry-run) jobs fetch, normalise and match without writing; importing from a preview reuses the cached responses. The worker is `pnpm worker`; hosts without a persistent process use an opt-in scheduled GitHub Actions workflow (`--drain --max-minutes 8`). The Import Center (`/admin/import-center`) has Providers (status, health, test, on/off, caps, quota, errors), Discover (cost shown first), Jobs, Mappings (including the unmapped-feature report) and Coverage. Enabling a provider creates its source with usage not permitted; jobs are refused until an admin confirms the licence. An offline synthetic fixture provider exists for tests and demos only (env refuses it outside demo mode).
- **Reason:** The brief's requirements (no paid infrastructure, separate worker, resume, dedupe, caps, cancellation, retries, quota-aware scheduling, admin control) and the platform (Vercel has no persistent process).
- **Alternatives:** pg-boss / graphile-worker (the owner chose own tables); Vercel Cron (plan-dependent limits, short function time); running jobs in route handlers (forbidden by the brief).
