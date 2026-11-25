# Free-data product import

Imports product data from sources that are free to use today, with every value traceable to its
source and nothing published without an editor's review. Decisions: `docs/DECISIONS.md` D77–D78.

## Sources

| Provider                     | Role                                                                   | Status                                                                    |
| ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Open Icecat (free tier only) | Primary: identity, specifications, images                              | Stage 4 — needs its current API documentation checked first               |
| Wikidata / Wikimedia Commons | Identity, release dates, links; Commons images with per-image licences | Stage 5 — needs its current API documentation checked first               |
| UPCitemdb (free trial)       | GTIN enrichment / cross-check only, ≤ 90 lookups a day here, no offers | Stage 6 — terms decide whether values may be stored or only cross-checked |
| eBay Browse API              | Optional, off by default                                               | Stage 7 — only after a licence report and the owner's approval            |

Not used: Amazon, Full Icecat, paid UPCitemdb plans, Best Buy, any scraping. If a source stops
being free, work on it stops and the owner is told; nothing switches to a paid plan.

## How it fits together

```
admin Import Center ──queue──▶ import_jobs (kind = provider) ──▶ worker (pnpm worker)
                                                                    │
                    provider adapter (capabilities, licence, quotas, allowed hosts)
                                                                    │
                     shared HTTP client ── response cache ── quota ledger (reserve before call)
                                                                    │
                   ProviderRecord ──▶ normalise ──▶ match ──▶ apply or queue for review
                                                     (GTIN → MPN+brand → model+brand; names only suggest)
```

- **Adapters** (`src/modules/providers/core/types.ts`) declare capabilities, licence (store vs
  cross-check only, attribution, image licensing), quota rules, allowed API hosts and request
  spacing. They return `ProviderRecord`s and never write to the catalogue.
- **HTTP client** (`core/http.ts`): https only, the adapter's hosts only, no redirects followed;
  timeouts; retries for network errors, timeouts, 429 and 5xx with exponential backoff and full
  jitter; `Retry-After` honoured up to 2 minutes (longer waits reschedule the job); 5 MB body cap;
  logs with credentials redacted (`src/lib/log.ts`), never headers.
- **Quota ledger** (`core/quota.ts`, table `provider_quota_usage`): every HTTP attempt first
  reserves one unit in each of the adapter's quota rules, in one atomic statement per rule that
  refuses to pass the limit — concurrent workers cannot overshoot. Cached responses use no quota.
- **Response cache** (`core/cache.ts`): raw responses keyed without credentials, so mappings can be
  re-run without new calls.
- **Settings and health** (`core/settings.ts`): a provider runs only when it has an adapter, its
  env configuration is present and an admin switched it on (audited).
- **Status** (D77): imported products start as `needs_review`; only editors publish.
- **Images** (`src/lib/security/remote-images.ts`): provider images are stored as remote URLs
  with author and licence, start as `needs_review` (an `image_rights` review item) and are shown
  only when approved and their host is on the allow-list (which also feeds the CSP). The list is
  empty until each provider's documented image host is verified.

## Configuration

All optional (`.env.example`); the app builds and runs with none of them.

| Variable                                                                      | Purpose                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ICECAT_USERNAME`, `ICECAT_API_TOKEN`, `ICECAT_CONTENT_TOKEN`                 | Open Icecat account (tokens only if the account has them)          |
| `ICECAT_DEFAULT_LANG`                                                         | Content language, default `en`                                     |
| `WIKIDATA_USER_AGENT`                                                         | Required by Wikimedia: client name/version plus a URL or email     |
| `UPCITEMDB_ENABLED`, `UPCITEMDB_DAILY_BUDGET`                                 | Off by default; our cap (default 90, max 100) under the free limit |
| `EBAY_ENABLED`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_MARKETPLACE_ID` | Off by default; Stage 7 only                                       |
| `PROVIDER_LIVE_TESTS`                                                         | Live smoke tests run only when `true`                              |

Credentials are read on the server only and never stored in the database or logged.

## First steps

1. `pnpm db:migrate`
2. `pnpm catalog:bootstrap --dry-run`, then `pnpm catalog:bootstrap`: creates the six target
   categories and their specification definitions (never changes existing ones).
3. Provider adapters and the Import Center follow in Stages 4–9.

How records are matched, merged and protected: [identity-and-provenance.md](identity-and-provenance.md).

## Testing

Ordinary test runs make zero real API calls: the HTTP client takes an injected `fetch`, and the
unit tests replace the global `fetch` with one that fails the test. Live smoke tests (from Stage 4)
run only with `PROVIDER_LIVE_TESTS=true`.

## Stage status

| Stage | Content                                                                                      | Status                                                                             |
| ----- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1     | Inspection report                                                                            | Done (approved)                                                                    |
| 2     | Single status; schema; adapter contract; HTTP client; quota ledger; cache; settings; env     | Done                                                                               |
| 3     | Normalisation, GTIN-14, category definitions + bootstrap, matching, provenance, safe upserts | Done ([details](identity-and-provenance.md))                                       |
| 4–7   | Icecat, Wikidata, UPCitemdb, eBay adapters                                                   | Blocked: provider documentation sites are not reachable from the build environment |
| 8–11  | Admin Import Center, jobs/worker, tests and docs, verification                               | Planned                                                                            |
