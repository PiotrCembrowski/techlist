# Import workflow

Pipeline: discovery → preview → duplicate check → validation → review → verification → publish.
Nothing reaches the public catalogue without an editor.

## First import

1. `pnpm db:migrate` and `pnpm catalog:bootstrap` (once).
2. Configure and switch on a provider, confirm its licence ([providers.md](providers.md)).
3. **Mappings** (Import Center → Mappings, per provider):
   - **Category:** the provider's category ID → our category. Records from unmapped categories
     are held back.
   - **Brand:** only needed when the provider spells a brand differently from ours (names and
     aliases are matched automatically). Unknown brands are held back; create the brand first.
   - **Features:** provider feature ID (or name) → one of our specifications. Set a unit only when
     the provider documents it for bare numbers. Features without a mapping are kept raw and
     listed under “Unmapped features” after the first imports — map or ignore them there.
4. **Discover:** choose the provider, look up by keyword, GTINs or provider IDs, pick the
   category it is for, and **Preview first**. The table above the form shows what each lookup
   costs and how much quota is left.
5. Run the worker (`pnpm worker --drain` locally, or wait for the schedule — [worker.md](worker.md)).
6. The job page shows each record: identifiers, mapped category, specifications, missing core
   specifications, the duplicate check (new / updates existing / needs review, with candidates and
   confidence), and licence warnings. Tick records and **Import selected**, or
   **Import all eligible**. Previewed responses are cached, so this costs no extra requests.
7. Run the worker again. Imported products and variants are `needs_review`.

## Review and publish

Everything that needs a decision is in **Review queue**:

| Item               | When                                        | Decision                                                     |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| New product        | Every imported product                      | Verify and publish, or reject                                |
| Possible duplicate | Similar name, or identifiers that disagree  | Same product (merge) · a variant of it · a different product |
| Variant ambiguity  | Several variants could match                | Pick the variant, or create a new one                        |
| Field conflict     | A provider disagrees with a protected value | Apply the provider value (or an edited one) · keep ours      |
| Conflicting value  | Same, for a specification                   | Apply (becomes verified) · keep ours                         |
| Image rights       | Every provider image                        | Rights confirmed (shown) · do not use                        |

You can also open the product (link on the job page) and use its **Status** buttons
(verify, publish, reject, archive). Publishing records the verification date.

## Bulk imports

- Paste up to `IMPORT_JOB_MAX_ITEMS` GTINs or IDs per job, or run keyword searches per brand.
- Keep the item cap low at first (the default in the form is 50) and check the preview.
- Big jobs run across several worker runs; progress is on the Jobs tab.
- The goal is quality over count: a first catalogue of 500–1,000 reviewed products. Products the
  free sources lack can be entered by hand (Products → New), which records manual provenance.

## Coverage

Import Center → Coverage shows, per target category, products by status, products per provider,
the hits of the latest discovery search for that category, and which major brands are still
missing (the list is in `src/modules/import-core/catalog-config.ts`).

## Troubleshooting

| Symptom                                                           | Cause and fix                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| “has no adapter yet”                                              | The provider's adapter is not built (Stages 4–7).                                            |
| “is not configured (…)”                                           | Set the named env variables and restart the app and the worker.                              |
| “Confirm the licence … (usage permitted)”                         | Sources → the provider → tick “Usage is permitted” if the licence allows it.                 |
| Job stays “queued”                                                | No worker is running, or it is waiting for a quota reset (“resumes …” on the job page).      |
| Items “needs review” with “Unknown brand” / “No category mapping” | Create the brand or add a brand/category mapping, then queue the record again.               |
| Specification missing although the provider has it                | The feature is unmapped (Mappings → Unmapped features) or was rejected (preview “Warnings”). |
| “no unit given”                                                   | The provider sent a bare number; add the documented unit to the feature mapping.             |
| Same import refused                                               | An identical job is already queued or running.                                               |
| Image not shown publicly                                          | Approve its rights in the review queue; remote hosts must also be on the allow-list.         |
