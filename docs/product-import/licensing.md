# Licensing and attribution

Rules the import system enforces (DECISIONS D78–D80). Provider-specific terms are still to be
verified (see [providers.md](providers.md)).

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
