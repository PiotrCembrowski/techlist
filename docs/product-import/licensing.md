# Licensing and attribution

Rules the import system enforces (DECISIONS D78–D81). Provider-specific terms: Open Icecat
below; the others are still to be verified (see [providers.md](providers.md)).

## Data

- A provider's data is imported only after an admin ticks **Usage is permitted** on its source
  (Sources page). The source row is created with the adapter's licence name and attribution text,
  and with usage _not_ permitted.
- An adapter declares `usage: "store"` or `"cross_check_only"`. Cross-check-only data is never
  stored as a catalogue value (the import refuses).
- Each source record stores the licence name, licence URL and attribution text that applied when
  it was imported. Product pages list their sources with retrieval dates.
- Every value keeps field-level provenance (source, raw value, retrieval time, confidence). No
  value is invented or inferred; missing data stays missing.

## Images

- An image URL from an API does not grant redistribution rights. Provider images are stored as
  remote references with author, licence, licence URL, size and type, and start as
  **needs review**; they are shown only after an editor approves their rights.
- Remote images are also shown only from hosts on the allow-list
  (`src/lib/security/remote-images.ts`, which also feeds the CSP). It is empty until each
  provider's image host is verified. Wikimedia Commons files keep their own author and licence.
- Images are not downloaded or re-hosted. If re-hosting is added later, it must allow-list hosts,
  block private and loopback addresses, cap size, check the MIME type against the actual bytes,
  and use timeouts.

## Credentials and privacy

- Keys and tokens are read from the environment on the server only; they are never stored in the
  database, sent to the browser, written to logs (logs and cache keys are redacted), or shown in
  the admin.
- Raw provider responses are stored for re-processing and are visible only to admins.

## Open Icecat — before ticking “Usage is permitted”

Open Icecat content is free under the **Open Content License v1.4** (2026-02-11,
<https://iceclog.com/open-content-license/>) and the **Open Icecat Fair Use Policy**
(2026-05-02, <https://iceclog.com/open-icecat-fair-use-policy/>). Summary of what they ask
(read the originals; this is not legal advice):

| Condition                                                                                                                                                                    | Where it stands                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A free Open Icecat account (OCL §7)                                                                                                                                          | Your action: register; set `ICECAT_API_TOKEN` or `ICECAT_USERNAME`. The public demo account is refused                                                                                                  |
| Notice on each copy: “Database Right data-sheet [Year] Icecat. All rights reserved.” plus the “as is” no-warranty disclaimer (OCL §1, Fair Use)                              | Done: each product page lists the source with its licence (linked) and the notice with the retrieval year (D82). Check that this placement is “conspicuous” enough for you                              |
| Modified content must carry notices of what changed and when (OCL §2a)                                                                                                       | Done: each imported source on a product page says the data was changed on import (units converted, text tidied), with the date; the data policy page explains it; values as received are kept (D82)     |
| Works containing the content are licensed free of charge to third parties under the OCL (OCL §2b); no fee for the content or for access to it (OCL §1)                       | **Your decision:** compatible with a free public site; incompatible with charging for access to the catalogue                                                                                           |
| No machine-learning training, model generation or synthetic content with the data (OCL §10); robots.txt should exclude crawlers that copy content for AI training (Fair Use) | Done: `src/app/robots.ts` disallows AI-training crawlers (GPTBot, CCBot, Google-Extended, Applebot-Extended, ClaudeBot, anthropic-ai, Bytespider, meta-externalagent); search crawlers unaffected (D82) |
| Use the most recent content (OCL §4)                                                                                                                                         | Re-sync interval on the Providers tab; changed payloads are re-imported (unchanged ones only update `last_seen_at`)                                                                                     |
| At most 1 million data sheets a month (Fair Use)                                                                                                                             | Enforced: 30,000 requests per UTC day in the quota ledger                                                                                                                                               |
| Tell merchant and manufacturer contacts about Open Icecat (OCL §8, Fair Use)                                                                                                 | Your action                                                                                                                                                                                             |

Images: Icecat's JSON manual says to download images and host them yourself and not to link to
Icecat file links. The import does not re-host images, so **no Icecat images are imported** and
no Icecat image host is on the allow-list. Adding them needs the re-hosting work described under
Images above.
