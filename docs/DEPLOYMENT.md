# Deployment

One Node.js (≥ 22) Next.js application and one PostgreSQL 16 database. No other services are
required; uploaded images go to local disk (single server) or any S3-compatible bucket.

## Hosting options

| Option                                                                                       | Notes                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node server / container** (VM, Fly.io, Railway, Render, Kubernetes if you already have it) | `pnpm install --frozen-lockfile && pnpm build`, then `pnpm start -p $PORT`. Put a reverse proxy (Caddy, nginx, the platform's load balancer) in front for TLS and set `TRUSTED_PROXY_HOPS` to the number of proxies. Use `STORAGE_DRIVER=s3` when you run more than one instance or the disk is not persistent. |
| **Vercel**                                                                                   | Works as a standard Next.js 16 app (the proxy runs on the Node.js runtime). The filesystem is read-only: use `STORAGE_DRIVER=s3`. Vercel sets `X-Forwarded-For`; `TRUSTED_PROXY_HOPS=1`.                                                                                                                        |

Health check: `GET /api/health` → `200 {"status":"ok","database":"ok"}`, `503` when the database is
unreachable. Logs are single-line JSON on stdout/stderr (no personal data or secrets).

## Managed PostgreSQL

Any PostgreSQL 16 with the **`pg_trgm`** and **`unaccent`** extensions (Neon, Supabase, RDS, Cloud
SQL, Azure, Crunchy all provide them). The first migration runs `CREATE EXTENSION IF NOT EXISTS`;
on providers where the application role cannot create extensions, create them once as an admin.
`pnpm db:check` reports the version and whether the extensions are available. Use a pooled
connection string if the provider offers one and keep `DB_POOL_MAX` × instances below the
provider's connection limit.

## Environment variables

Set in the platform's secret store, never in the repository (`.env.example` lists them all):

| Variable                                                         | Production value                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                   | Managed PostgreSQL URL (TLS: add `?sslmode=require` if the provider needs it).                                         |
| `SITE_URL`                                                       | The public `https://` origin (canonical URLs, sitemap, HSTS and `upgrade-insecure-requests` depend on it).             |
| `AUTH_SECRET`                                                    | ≥ 32 random characters (`openssl rand -base64 32`). Rotating it signs every admin out.                                 |
| `TRUSTED_PROXY_HOPS`                                             | Number of proxies that append to `X-Forwarded-For` (usually 1). Wrong values let clients pick their rate-limit bucket. |
| `STORAGE_DRIVER`, `S3_*` / `STORAGE_LOCAL_DIR`                   | Image storage (see below).                                                                                             |
| `ENABLE_DEMO_DATA`                                               | `false` for a real catalogue. `true` shows the demo banner and makes the whole site `noindex`.                         |
| `ALLOW_DEMO_SEED`                                                | Leave `false`. The demo seed refuses to run with `NODE_ENV=production` otherwise.                                      |
| `OFFER_STALE_HOURS`, `SUSPICIOUS_PRICE_DEVIATION`, `DB_POOL_MAX` | Defaults are fine to start.                                                                                            |
| `MANUFACTURER_FILES_DIR`, `LICENSED_FEED_*`, `AFFILIATE_FEED_*`  | Only with a provider agreement (`docs/DATA_ACQUISITION.md`).                                                           |

The app validates all variables at startup and refuses to start with a readable error.

## Storage

- `STORAGE_DRIVER=local` stores files under `STORAGE_LOCAL_DIR` (default `storage/uploads`). Only
  for a single server with a persistent disk; include the directory in backups.
- `STORAGE_DRIVER=s3` with `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT` (Cloudflare R2, MinIO,
  …) and `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (or the platform's default credentials). The
  bucket can stay private: files are served through `/media/<key>` with safe headers. Enable bucket
  versioning or replication for backups.

## Migrations in CI/CD

- Migrations are plain SQL files in `src/db/migrations/` (generated by Drizzle Kit or hand-written)
  and are applied in order by `pnpm db:migrate` (tracked in the `drizzle` schema). Never edit a
  migration that has been applied anywhere; add a new one.
- Run `pnpm db:migrate` as a **release step before** the new version starts serving (e.g. a
  pre-deploy command, a CI job with production database access, or the platform's release phase).
  Migrations up to 0006 only add objects or replace views/functions, so the previous version keeps
  working while they run. **0007 drops the old product status columns** (DECISIONS D77): the
  version before it stops working once it runs, so run it as part of the same release.
- `.github/workflows/ci.yml` runs typecheck, lint, formatting, migrations from scratch, the demo seed
  twice, unit and integration tests and the Playwright e2e suite against a PostgreSQL 16 service.
- `pnpm db:migrate:fresh` (drops the schema) refuses to run with `NODE_ENV=production`.

## First deployment

1. Create the database and set the environment variables.
2. `pnpm db:migrate`.
3. `pnpm admin:create --email you@example.com --name "Your Name"` (password asked twice, hidden;
   the first account is the owner). There is no default account.
4. Create your sources (with licence details and "usage permitted"), categories, specification
   definitions, brands and retailers in the admin, or import CSV files.
5. Check `/api/health`, `/robots.txt` and `/sitemap.xml` (the index; files are `/sitemaps/0.xml`, …).

Do not run `pnpm db:seed` against a real catalogue: it loads fictional demo data.

For the free-data product import: run `pnpm catalog:bootstrap` once after the migrations, and run
the import worker (`pnpm worker`) on an always-on host or enable the scheduled GitHub Actions
workflow (`docs/product-import/worker.md`).

## Backup and restore

**Database.** Use the provider's automated backups / point-in-time recovery, and keep an
independent logical backup:

```bash
# Backup (custom format, compressed; schema + data)
pg_dump --format=custom --no-owner --no-privileges --file=specbase-$(date +%F).dump "$DATABASE_URL"

# Inspect a backup
pg_restore --list specbase-2026-11-20.dump | head

# Restore into an EMPTY database (create it first; extensions are created by the dump)
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL" specbase-2026-11-20.dump
```

- Run the backup at least daily and keep several generations off-site (e.g. a different provider or
  region). Encrypt backups at rest; they contain admin email addresses and password hashes.
- Test a restore regularly: restore into a scratch database, point a staging instance at it
  (`DATABASE_URL`), and check `/api/health`, an admin login and a few product pages.
- After restoring an older backup, run `pnpm db:migrate` to bring the schema up to the deployed
  version.

**Images.** Back up `STORAGE_LOCAL_DIR` together with the database dump, or enable versioning on
the S3 bucket. Database rows refer to files by key; a restored database needs the files from the
same point in time.

## Security checklist

- HTTPS only (`SITE_URL` must be `https://`; HSTS is then sent automatically).
- `AUTH_SECRET` and database credentials only in the secret store.
- `TRUSTED_PROXY_HOPS` matches your proxy setup.
- Admin accounts: create owners sparingly; deactivate accounts instead of sharing them (deactivation
  ends sessions immediately).
- Security headers and CSP are set by the app (`src/proxy.ts`, `next.config.ts`); don't strip them
  at the proxy.
