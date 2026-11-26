# Providers

> **Status of this page.** Nothing below has been checked against the providers' current
> documentation yet: their sites were not reachable from the build environment. The roles and
> limits come from the import brief and are **to be verified** before each adapter is written
> (Stages 4–7). If a provider turns out not to be free, it will not be used and you will be told;
> nothing switches to a paid plan.

| Provider                        | Role in the catalogue                                    | Access (per the brief)                                       | Limits (per the brief, unverified)                           | Adapter       |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------- |
| Open Icecat (free account only) | Primary: identity, specifications, images                | Free Open Icecat registration; username (+ tokens if issued) | Open Icecat content only; **Full Icecat is paid — excluded** | Not built yet |
| Wikidata / Wikimedia Commons    | Identity, families, release dates, links; Commons images | No key; descriptive User-Agent with contact details          | Wikidata data is CC0; each Commons file has its own licence  | Not built yet |
| UPCitemdb (free plan)           | GTIN enrichment / cross-check only; never offers         | No key on the free plan                                      | Brief: 100 requests/day, at most 20 searches; we cap at 90   | Not built yet |
| eBay Browse API                 | Optional offers; off by default                          | eBay developer account, OAuth client credentials             | Licence report and your approval required first              | Not built yet |
| Synthetic fixture provider      | Testing and demos only — **not real data**               | `FIXTURE_PROVIDER=true` with `ENABLE_DEMO_DATA=true`         | None (offline)                                               | Built         |

Excluded: Amazon, Full Icecat, UPCitemdb paid plans, Best Buy, and any scraping.

## Setting a provider up (once its adapter exists)

1. Put its settings in the environment (`.env.example`, "Free-data product import"). Keys stay on
   the server; they are never stored in the database or logged.
2. Import Center → Providers: **Switch on** (owners). This also creates the provider's row on the
   Sources page.
3. Sources → the provider: read its licence and tick **Usage is permitted** only if it allows
   publishing. Nothing is imported until this is ticked.
4. Optional: set a **daily request cap** and a **re-sync interval** on the Providers tab.
5. **Test connection** runs the adapter's health check through the same quota ledger.
6. Add **mappings** (categories, brands, features) — see [workflow.md](workflow.md).

## What still has to be verified per provider (Stages 4–7)

- Endpoints, authentication, response formats, rate and daily limits, and error behaviour.
- Licence: whether values and images may be stored and shown, and the exact attribution text.
- Image hosts (they go on the allow-list in `src/lib/security/remote-images.ts` and the CSP).
- For UPCitemdb: whether the free plan allows storing values, or only cross-checking them
  (`licence.usage = "cross_check_only"` makes the import refuse to store anything).
- For eBay: a written licence report for your approval before any code.
