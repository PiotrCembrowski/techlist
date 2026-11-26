# Free-data product import

Imports product data from sources that are free to use, with every value traceable to its source
and nothing published without an editor's review. Decisions: `docs/DECISIONS.md` D77–D80.

| Page                                                     | What it covers                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| [providers.md](providers.md)                             | Each provider: role, access, free limits, status, setup                |
| [workflow.md](workflow.md)                               | First import, bulk imports, review and publish, troubleshooting        |
| [worker.md](worker.md)                                   | Running the job worker locally, on a host, or on a schedule            |
| [identity-and-provenance.md](identity-and-provenance.md) | Normalisation, duplicate detection, variants, provenance, safe updates |
| [licensing.md](licensing.md)                             | Licence, attribution and image rules                                   |

## How it fits together

```
Admin → Import Center ──queue──▶ import_jobs (kind = provider) ──▶ worker (pnpm worker)
                                                                       │
                       provider adapter (capabilities, licence, quotas, allowed hosts)
                                                                       │
                        shared HTTP client ── response cache ── quota ledger (reserve before call)
                                                                       │
                      ProviderRecord ──▶ normalise ──▶ match ──▶ apply as needs_review, or review
                                                        (GTIN → MPN+brand → model+brand; names only suggest)
```

- **Adapters** (`src/modules/providers/core/types.ts`, registered in
  `src/modules/providers/adapters/`) declare capabilities, licence, quota rules, allowed API
  hosts, request spacing and cost. They return records and never write to the catalogue.
- **HTTP client** (`core/http.ts`): https to the adapter's hosts only, no redirects, timeouts,
  retries with exponential backoff and full jitter, `Retry-After` (longer than 2 minutes →
  the job is rescheduled), 5 MB body cap, credential-free logs.
- **Quota ledger** (`core/quota.ts`): every request first reserves a unit in each limit (the
  provider's own and the admin's daily cap) with one atomic statement; it refuses before a limit
  is passed, across all workers. Cached responses cost nothing.
- **Jobs** (`src/modules/import-jobs`): Postgres tables, claimed with `FOR UPDATE SKIP LOCKED` and
  a lease; batches, checkpoints, pause/resume, cancel, retry of failed items only, per-job item
  cap, dedupe of identical jobs. Preview jobs fetch and match without writing.
- **Import Center** (`/admin/import-center`): providers, discovery and preview, jobs, mappings,
  coverage; reviews go through the existing review queue.
- **Status** (D77): imports create `needs_review` products and variants; only editors publish.

## Configuration

All optional (`.env.example`); the app builds and runs with none of them.

| Variable                                                                      | Purpose                                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `ICECAT_USERNAME`, `ICECAT_API_TOKEN`, `ICECAT_CONTENT_TOKEN`                 | Open Icecat account (tokens only if the account has them)      |
| `ICECAT_DEFAULT_LANG`                                                         | Content language, default `en`                                 |
| `WIKIDATA_USER_AGENT`                                                         | Required by Wikimedia: client name/version plus a URL or email |
| `UPCITEMDB_ENABLED`, `UPCITEMDB_DAILY_BUDGET`                                 | Off by default; our own cap (default 90, max 100)              |
| `EBAY_ENABLED`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_MARKETPLACE_ID` | Off by default; Stage 7 only                                   |
| `IMPORT_JOB_MAX_ITEMS`                                                        | Hard cap on items per job (default 500, max 5000)              |
| `FIXTURE_PROVIDER`                                                            | Offline synthetic provider; only with `ENABLE_DEMO_DATA=true`  |
| `PROVIDER_LIVE_TESTS`                                                         | Live smoke tests run only when `true` (none exist yet)         |

Admin settings per provider (Import Center → Providers, owners only): on/off, a daily request
cap, and a re-sync interval in days.

## Migrations

`0006`–`0009` (`pnpm db:migrate`): single status (0007 drops the old status columns — deploy the
code together with it), import tables, manual provenance and raw records. Then
`pnpm catalog:bootstrap` creates the six target categories and their specifications.

## Testing

Ordinary test runs make no real API calls: the HTTP client takes an injected `fetch` and the unit
tests replace the global `fetch` with one that fails the test. Tests use synthetic, labelled
fixtures only. The Playwright journey `tests/e2e/journey-d-import.spec.ts` runs
search → preview → import → review → publish with the offline fixture provider and the real
worker process.

## Stage status

| Stage | Content                                                                                  | Status                                                                 |
| ----- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1     | Inspection report                                                                        | Done (approved)                                                        |
| 2     | Single status; schema; adapter contract; HTTP client; quota ledger; cache; settings; env | Done                                                                   |
| 3     | Normalisation, GTIN-14, category definitions + bootstrap, matching, provenance, upserts  | Done                                                                   |
| 4     | Open Icecat adapter + feature mappings                                                   | **Not built**: documentation not reachable from the build environment  |
| 5     | Wikidata adapter + Commons image licences                                                | **Not built**: same reason                                             |
| 6     | UPCitemdb adapter                                                                        | **Not built**: same reason                                             |
| 7     | eBay adapter                                                                             | **Not built**: needs the licence report and the owner's approval first |
| 8     | Import Center admin UI                                                                   | Done                                                                   |
| 9     | Jobs, worker, schedule                                                                   | Done                                                                   |
| 10    | Tests and documentation                                                                  | Done for everything built                                              |
| 11    | Verification                                                                             | Done (see the final report)                                            |
