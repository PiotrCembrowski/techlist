# Performance review (Stage 7)

Measured with `pnpm perf:bench` on a throwaway database (`PERF_DATABASE_URL`, name must end in
`_perf`): the demo seed plus **20,000 synthetic products** (varied made-up names, ~180,000
specification values, ~10,000 offers), PostgreSQL 16, local machine, median of five warm runs.
Synthetic rows exist only in that database and are never served.

| Path                                               | Before Stage 7 |        After |
| -------------------------------------------------- | -------------: | -----------: |
| Catalogue `/products`, page 1                      |          27 ms |     27–29 ms |
| Catalogue, page 200                                |          34 ms |     37–41 ms |
| Category + brand filter                            |           8 ms |         8 ms |
| Category, price sort in a market                   |          40 ms |     37–41 ms |
| Search: exact model number                         |         243 ms |    **20 ms** |
| Search: words                                      |         474 ms |    **30 ms** |
| Search: typo (trigram)                             |         432 ms |    **25 ms** |
| Search: no match                                   |              — |     15–18 ms |
| Search suggestions (prefix)                        |         225 ms | **78–80 ms** |
| Product page data                                  |           7 ms |         6 ms |
| Indexable products in a category (~7,500 products) |         106 ms |        65 ms |
| Sitemap: count / one file                          |   597 / 657 ms | 298 / 377 ms |

## What changed

- **Search** computed three similarity scores for every published product, which no index can
  serve. It now collects candidates through indexes only — `lower(model_number)` /
  `lower(manufacturer_part_number)` B-trees, the GTIN unique index, the full-text GIN index and a
  new trigram GIN index on `products.search_text` (`lower(unaccent(brand + " " + name))`,
  maintained by the search trigger) — and scores only those. The trigram operators' thresholds
  are set per transaction to the search's own cut-off, so the candidate set is a superset of the
  old result set; ranking is unchanged (the search integration tests pass unchanged).
- **Indexability** (`sb_indexable_products`) computes core-specification coverage only for
  candidate products (published, not demo, verified) and accepts category / brand / id filters,
  so page-level checks only touch the products in scope. The sitemap evaluates it once per
  request instead of once per category.

## Known limits

- The category and brand indexability checks scan the candidate products of that scope
  (~65 ms for 7,500). If categories grow far beyond that, store the coverage per product
  (maintained by triggers) or cache the check.
- The sitemap (~300–380 ms at 20,000 products) and `robots.txt` (which counts sitemap files) are
  computed per request. Both are requested rarely by crawlers; add HTTP caching at the edge if
  needed.
- Pages render per request (market cookie, CSP nonce), so there is no ISR (D70). The catalogue
  queries above stay well below 50 ms at this size.
