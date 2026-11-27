# The import worker

Provider jobs never run inside Next.js requests. They run in a separate process:

```bash
pnpm worker                                   # run until stopped; polls every 10 s
pnpm worker --drain --max-minutes 8           # process what is due, then exit (scheduled runs)
pnpm worker --drain --max-jobs 1              # one job
pnpm worker --drain --enqueue-sync            # first queue re-syncs for providers with an interval
```

It needs the same environment as the app (`DATABASE_URL`, `AUTH_SECRET`, provider settings).
Every run also deletes expired cached responses and quota rows older than 90 days.

## How jobs behave

- **Claiming:** `FOR UPDATE SKIP LOCKED` with a 5-minute lease that is renewed after every batch.
  Several workers can run at once; a job is never processed twice at the same time. If a worker
  dies, its lease expires and another worker continues from the pending items.
- **Batches:** 10 items at a time; each item is one transaction, so a crash never leaves half an
  item, and re-running an item changes nothing (idempotent upserts, payload hashes).
- **Time budget:** at `--max-minutes` the job pauses (back to `queued`) and resumes on the next run.
- **Quota:** when a limit is used up, the job goes back to the queue until the limit resets; a
  `Retry-After` longer than 2 minutes does the same. Items are not marked failed for this.
- **Errors:** an item that fails three times (or with a permanent error) is marked `failed` with
  the error; the job carries on. **Retry failed** on the job page re-queues only those items.
- **Cancel:** queued jobs stop at once; running jobs stop after the current item.
- **Caps:** each job has an item cap (≤ `IMPORT_JOB_MAX_ITEMS`); each provider can have a daily
  request cap. Identical jobs cannot be queued twice while one is queued or running.
- **Sync:** `--enqueue-sync` queues re-imports of records not seen for the provider's interval.
  Unchanged payloads only update “last seen”; a record a provider no longer returns is skipped —
  products are never deleted or marked discontinued because of that.

## Where to run it

| Host                                     | How                                                                                        | Trade-offs                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locally / any always-on machine or VM    | `pnpm worker` (e.g. under systemd, pm2 or a container restart policy)                      | Jobs start within seconds                                                                                                                                 |
| Vercel or another host without processes | `.github/workflows/import-worker.yml`: every 30 min, `pnpm worker --drain --max-minutes 8` | Free for public repositories; private ones use the account's included Actions minutes. Jobs start up to 30 min after queueing; big jobs take several runs |

### Enabling the scheduled workflow

It does nothing until you opt in (Settings → Secrets and variables → Actions):

- Variable `IMPORT_WORKER_ENABLED` = `true`, variable `SITE_URL`.
- Secrets `DATABASE_URL` and `AUTH_SECRET` (the production values), plus the provider secrets you
  use (`ICECAT_*`), and variables `WIKIDATA_USER_AGENT`, `UPCITEMDB_ENABLED`, `UPCITEMDB_DAILY_BUDGET`.

The workflow connects to the production database: give it a database role that only needs the
app's normal permissions, and check the provider's daily limits before setting a short schedule.
GitHub may delay or skip scheduled runs under load; “Run workflow” starts one by hand.
