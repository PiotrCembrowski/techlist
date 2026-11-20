# Data sources and provider adapters

Source hierarchy (SPEC §10): manufacturer documentation → licensed providers → approved affiliate
feeds/APIs → retailer feeds → manual research → AI-assisted extraction → community corrections
(reviewed).

Every source of data is a `sources` row with a licence note and a **usage permitted** flag.
Nothing is imported, attached or published from a source whose usage is not permitted
(rule 2.1.9). There are no scrapers and no network requests without configured credentials and an
agreement (rule 2.1.10).

## Adapters (`src/modules/providers`)

All adapters implement `ProductDataProvider`:

```ts
interface ProductDataProvider {
  readonly name: string;
  readonly sourceId: string;
  isConfigured(): boolean;
  fetchProducts(options?: { since?: Date; limit?: number }): Promise<unknown[]>;
  normalizeProduct(raw: unknown): Promise<NormalizedProduct>; // validated by Zod
}
```

| Adapter                     | Status                                            | Settings                                       |
| --------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `CsvProductProvider`        | Implemented (used by **Admin → Import & export**) | none                                           |
| `ManufacturerFilesProvider` | Stub                                              | `MANUFACTURER_FILES_DIR`                       |
| `LicensedFeedProvider`      | Stub                                              | `LICENSED_FEED_URL`, `LICENSED_FEED_API_KEY`   |
| `AffiliateFeedProvider`     | Stub                                              | `AFFILIATE_FEED_URL`, `AFFILIATE_FEED_API_KEY` |

The stubs report **Not configured** on **Admin → Data providers** until their settings are present.
Even then they refuse to fetch: no provider has been contracted, so there is no implementation to
call. To add one:

1. Get a written agreement that permits storing and publishing the data (and images, if any).
2. Create a `sources` row for it with the licence details and **usage permitted** ticked.
3. Put the credentials in the environment (never in the repository) and add them to
   `src/config/env.ts` if they differ from the names above.
4. Implement `fetchProducts` (respecting the provider's rate limits and terms) and
   `normalizeProduct` (map to `NormalizedProduct`; the CSV adapter shows the expected shape).
5. Feed normalized products through the import pipeline (`src/modules/imports`) so duplicate
   detection, verified-value protection and the review queue apply to them as well.

## CSV imports

See **Admin → Import & export**. Templates and exports use the same columns (SPEC §9.6), so an
export can be edited and imported again. `docs/samples/products-import-sample.csv` is a small
fictional example (demo brand, `is_demo=true`) with deliberate errors and a likely duplicate.

## AI-assisted extraction

Not integrated. The hook exists: `setSpecificationValue({ origin: "ai_extracted", confidence })`
always stores the value as **unverified** and creates an `unverified_spec` review item
(rule 2.1.8). An editor approves (verifies) or rejects (removes) it in the review queue.

## Reader corrections

The public "Suggest a correction" form on product pages creates `correction` review items. It is
rate limited per address and has a honeypot field. Approved corrections are stored with the source
"Reader corrections (reviewed)".
