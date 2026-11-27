# Providers

> **Status of this page.** Open Icecat (2026-11-26) and Wikidata / Wikimedia Commons
> (2026-11-27) were checked against their current documentation (see below). The other rows still
> come from the import brief and are **to be verified** before their adapters are written
> (Stages 6–7). If a provider turns out not to be
> free, it will not be used and you will be told; nothing switches to a paid plan.

| Provider                        | Role in the catalogue                                   | Access (per the brief)                               | Limits (per the brief, unverified)                         | Adapter       |
| ------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ------------- |
| Open Icecat (free account only) | Primary: identity, specifications (images: see below)   | Free Open Icecat account; API token or user name     | Fair use: < 1 M data sheets/month; we cap at 30,000/day    | **Built**     |
| Wikidata / Wikimedia Commons    | Identity, families, release dates, measurements; images | No key; descriptive User-Agent with contact details  | 200 requests/min (2026); we cap at 150/min                 | **Built**     |
| UPCitemdb (free plan)           | GTIN enrichment / cross-check only; never offers        | No key on the free plan                              | Brief: 100 requests/day, at most 20 searches; we cap at 90 | Not built yet |
| eBay Browse API                 | Optional offers; off by default                         | eBay developer account, OAuth client credentials     | Licence report and your approval required first            | Not built yet |
| Synthetic fixture provider      | Testing and demos only — **not real data**              | `FIXTURE_PROVIDER=true` with `ENABLE_DEMO_DATA=true` | None (offline)                                             | Built         |

Excluded: Amazon, Full Icecat, UPCitemdb paid plans, Best Buy, and any scraping.

## Open Icecat (checked 2026-11-26)

Sources read: [Manual for Channel Partners: Icecat Product JSON](https://iceclog.com/manual-for-icecat-json-product-requests/)
(v3.1, updated 2026-11-17), [Open Content License](https://iceclog.com/open-content-license/)
(v1.4, 2026-02-11), [Open Icecat Fair Use Policy](https://iceclog.com/open-icecat-fair-use-policy/)
(2026-05-02). Adapter: `src/modules/providers/adapters/icecat.ts`.

| Topic          | What Icecat documents                                                                                                                                                     | What the adapter does                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint       | `GET https://live.icecat.biz/api` (CDN) or `https://live-origin.icecat.biz/api`; the CDN can silently drop bulk traffic from one address, so bulk imports use live-origin | Calls `live-origin.icecat.biz` only (the HTTP client refuses any other host)                                                                |
| Identify       | `icecat_id`, `Brand` + `ProductCode`, or `GTIN` (leading zeros allowed); no free-text search                                                                              | GTIN lookup and Icecat-ID fetch; no keyword search (discovery would need the XML index files)                                               |
| Auth           | `api-token` header (recommended; then no user name) or `shopname` = user name for Open Icecat; `content-token` header is added to file links                              | Sends the API token if set, otherwise `shopname`; never sends the content token (it would end up in stored links); refuses the demo account |
| Sections       | `content=` granular list                                                                                                                                                  | `generalinfo,featuregroups,catalogobjectcloud`                                                                                              |
| Coverage       | Open Icecat = brands that sponsor Icecat; Full Icecat brands return **error 9** for free accounts                                                                         | Error 9/12/14/15 → item fails with the reason; 8/16/17 → “not found”                                                                        |
| Limits         | Fair use: no more than 1 million data-sheet downloads a month per country/language repository; no per-second limit documented                                             | Ledger: 30,000 requests per UTC day (≤ 930,000 in any month), 200 ms between requests, responses cached 24 h                                |
| Values         | `RawValue` for comparison, `PresentationValue` for display; unit in `Feature.Measure.Signs._`; release date `DD-MM-YYYY`; `GTIN` holds confirmed GTINs only               | Imports `RawValue` + unit sign; converts the date to ISO; no quality marker exists in Product JSON                                          |
| Files / images | “Icecat is not a file host”: download images and host them yourself; do not link to Icecat file links                                                                     | **Images are not imported** (re-hosting is not built; see [licensing.md](licensing.md))                                                     |

Live check (2026-11-27, with the owner's API token, local dev database): **Test connection**
passed; a preview of Icecat product 56195846 (the manual's example) returned 203 features with
the shapes above, and after a brand mapping, a category mapping (Icecat 151 "Laptops") and six
feature mappings it was eligible with screen size, RAM, storage, OS, battery and weight parsed
(2700 g → 2.7 kg; `"` read as inches). Differences from the manual: `GeneratedLocalTitle` and
`Title` hold the long marketing title, so the adapter names products from `GeneratedIntTitle`
("DELL G5 5587"). A GTIN restricted by its brand returned error 14 and was reported as such.

Mappings: Icecat feature IDs (`Feature.ID`) and category IDs differ per category and are not
seeded — none could be verified here. After a first preview, map them from Mappings →
Unmapped features (by ID; name mappings also work). Yes/no features arrive as `Y`/`N`, which the
specification parser already reads as yes/no; inch values arrive with the unit `"`, which the
unit registry reads as inches.

## Wikidata / Wikimedia Commons (checked 2026-11-27)

Sources read (Wikimedia wikis, current revisions): API:Etiquette; Wikimedia Foundation API Usage
Guidelines (v1.0, 2024-08-26); User-Agent policy; **Wikimedia APIs/Rate limits** (new in 2026);
Manual:Maxlag parameter; Wikidata Query Service user manual; Help:Extension:WikibaseCirrusSearch;
Wikidata:Licensing; Commons:Reusing content outside Wikimedia (+ /technical);
Extension:CommonsMetadata; API:Imageinfo. Property IDs were read from Wikidata itself. Adapter:
`src/modules/providers/adapters/wikidata.ts`.

| Topic        | What Wikimedia documents                                                                                                                                | What the adapter does                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API          | Action API (`/w/api.php`); SPARQL service v1 is being replaced (degrades from Feb 2027)                                                                 | `www.wikidata.org` (`wbgetentities`, `list=search`) and `commons.wikimedia.org` (`prop=imageinfo`); no SPARQL                                                               |
| Identity     | Requests need a User-Agent naming the client with contact details (URL or email); including “bot” is recommended                                        | `WIKIDATA_USER_AGENT` is required (env validation checks for a URL or email); it is sent on every request                                                                   |
| Rate limits  | 2026: **200 requests/min** with a compliant User-Agent, **10/min** without contact details; ≤ 3 concurrent; honour `Retry-After` on 429/503             | 150 requests/min in the quota ledger, 400 ms spacing, one request at a time; `Retry-After` honoured (long waits reschedule the job)                                         |
| maxlag       | Non-interactive clients send `maxlag=5`; a lag error comes with HTTP 200 and `Retry-After`; wait ≥ 5 s                                                  | Sends `maxlag=5`; a lag error reschedules the job in 5 s and is never cached                                                                                                |
| Lookup       | `haswbstatement:P3962=<GTIN>` (statement search); GTINs are rare on Wikidata (≈ 2,900 items in total, mostly books and media, on 2026-11-27)            | GTIN lookup searches the 14/13/12-digit forms; **search** (keyword, items with a manufacturer or brand) and **item IDs** (`Q…`) are the main paths                          |
| Fields       | P176 manufacturer, P1716 brand, P179 series, P577 publication date, P13351 model number, P3962 GTIN, P18 image; product models are “subclass of” a kind | Brand = brand, else manufacturer; category = “subclass of”, else “instance of”; one model number / release date only when there is exactly one (regional values kept apart) |
| Measurements | Quantities with a unit item (e.g. millimetre, gram, gigabyte)                                                                                           | Imported as features with the unit's English name (the unit registry reads them); a unit without a label is dropped, never guessed                                          |
| Licence      | Structured data is CC0                                                                                                                                  | Stored; no attribution required (“Data from Wikidata (CC0)” is recorded on the source)                                                                                      |
| Images       | Each Commons file has its own licence; hotlinking is allowed but not recommended; credit as the licence requires (author, licence, source)              | Up to 3 best `P18` images; thumbnails on `upload.wikimedia.org` (on the allow-list and in the CSP) with author, licence, licence URL, file page and restrictions            |

The 10-requests-a-minute tier is easy to hit from shared IP addresses: set `WIKIDATA_USER_AGENT`
with real contact details, e.g. `SpecbaseImportBot/1.0 (https://your-site.example/contact; ops@your-site.example)`.

Mappings: map Wikidata classes (category, e.g. the item's “subclass of”) and property IDs
(features, e.g. `P2067` mass) from Mappings → Unmapped features after a first preview; the
category name shown is the class's English label.

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

## What still has to be verified per provider (Stages 6–7)

- Endpoints, authentication, response formats, rate and daily limits, and error behaviour.
- Licence: whether values and images may be stored and shown, and the exact attribution text.
- Image hosts (they go on the allow-list in `src/lib/security/remote-images.ts` and the CSP).
- For UPCitemdb: whether the free plan allows storing values, or only cross-checking them
  (`licence.usage = "cross_check_only"` makes the import refuse to store anything).
- For eBay: a written licence report for your approval before any code.
