# Roadmap

What is deliberately not in the MVP, and what was deferred during the build. The architecture keeps
room for each item (SPEC §20); none of it is half-built in the code.

## Deferred from the build (operational improvements)

| Item                                                                  | Why deferred                                                                                                                                                                                  | Where it would go                                                                                                                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Background import jobs** for large CSV files                        | Imports run inside the admin request. Previews of 10,000 rows take seconds; committing 10,000 _new_ products takes minutes (`docs/PERFORMANCE.md`), longer than many hosts allow per request. | A job runner (a Postgres-backed queue such as `pg-boss`, or a cron worker) that processes `import_jobs` in batches; the import page polls the job's counts. The planning/commit code is already batch-oriented. |
| Image resizing and responsive variants                                | Originals (≤ 5 MB, JPEG/PNG/WebP) are served as uploaded.                                                                                                                                     | Generate sizes on upload (e.g. `sharp`) into the storage driver; serve with `srcset`.                                                                                                                           |
| S3 storage driver verified against a real bucket                      | No bucket or credentials in the build environment.                                                                                                                                            | `src/lib/storage` (code exists, untested against a live service).                                                                                                                                               |
| Stored indexability coverage per product                              | Computed on demand; ~65 ms for a 7,500-product category.                                                                                                                                      | Trigger-maintained column, if categories grow past ~10,000 products.                                                                                                                                            |
| Cached sitemap / `robots.txt`                                         | Computed per request (~0.3–0.5 s at 20,000 products); crawlers request them rarely.                                                                                                           | HTTP caching at the edge or a periodic regeneration.                                                                                                                                                            |
| Provider adapters (manufacturer files, licensed feed, affiliate feed) | Need agreements and credentials (rule 2.1.10).                                                                                                                                                | `src/modules/providers` — stubs and the interface exist (`docs/DATA_ACQUISITION.md`).                                                                                                                           |
| AI-assisted extraction                                                | Out of scope for the MVP; the hook exists (`origin = ai_extracted`, confidence, review item).                                                                                                 | A provider module that writes through `setSpecificationValue`.                                                                                                                                                  |
| Structured data checked with an external validator                    | No network access to Google's tools during the build.                                                                                                                                         | Manual check after the first deployment.                                                                                                                                                                        |
| Search beyond PostgreSQL                                              | Postgres FTS + trigram is fast at the measured size (`docs/PERFORMANCE.md`).                                                                                                                  | `SearchService` is an interface; swap the implementation if a measured need appears.                                                                                                                            |

## Out of scope for the MVP (SPEC §20)

- Public accounts, user reviews and ratings, forums.
- Subscriptions, API billing, checkout.
- Mobile apps.
- AI recommendation engine.
- Real-time price tracking and automated scraping (also excluded by rule 2.1.10).
- Currency conversion (offers are shown in each retailer's own currency).
- Multi-language UI.
- Price history charts (price history is already recorded, append-only, per offer).

## Possible next steps once real data exists

1. Contract a first licensed data source; implement its adapter through the import pipeline.
2. Background import jobs (above), then scheduled offer feeds per retailer.
3. Editorial tooling: bulk verification views per category, coverage reports per definition.
4. Price history charts from `price_history` (data is already there).
