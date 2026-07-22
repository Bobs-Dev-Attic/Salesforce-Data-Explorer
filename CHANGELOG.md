# Changelog

All notable changes to Salesforce Data Explorer are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.5.3] - 2026-07-22

### Fixed

- **Saving a connection** failed with "there is no unique or exclusion constraint
  matching the ON CONFLICT specification" because the `org_id` unique index is
  partial (`WHERE org_id IS NOT NULL`), which Postgres rejects as an
  `ON CONFLICT` target. `saveConnection` now does an explicit find-or-update
  instead of an upsert — no schema/migration change required.

## [0.5.2] - 2026-07-22

### Fixed

- **Connections page actions** — the Edit/Delete (and Rename/Disconnect) buttons
  could be pushed off-screen after the Client Credentials button was added, since
  the action cells didn't wrap. Action buttons now wrap onto multiple lines and
  are always visible.

## [0.5.1] - 2026-07-22

### Added

- The app **version** (from `package.json`) is now shown as a badge next to the
  "Salesforce Data Explorer" title in the header, so the running build is
  visible at a glance.

## [0.5.0] - 2026-07-22

### Added

- **Client Credentials connection** — connect an org server-to-server (like the
  Postman `grant_type=client_credentials` flow) with **no browser redirect and no
  callback URL**, sidestepping `redirect_uri` configuration entirely. Requires the
  Connected App to have "Enable Client Credentials Flow" with a run-as user.
  Access tokens are minted on demand from the stored (encrypted) client secret;
  no refresh token is used. New **"Connect (Client Credentials)"** button on each
  Connected App and endpoint `POST /api/salesforce/connect-client-credentials`.

## [0.4.1] - 2026-07-22

### Added

- **OAuth diagnostics endpoint** `GET /api/salesforce/debug` (app-auth gated):
  reports the exact `redirect_uri` the app sends, the effective `APP_BASE_URL`,
  which env vars are present (booleans only, never values), and every saved
  Connected App's Consumer Key + authorize URL — to quickly resolve
  `redirect_uri_mismatch` and configuration issues. No secrets are exposed.
- Server-side logging of the OAuth login `redirect_uri`/`client_id` and of
  callback token-exchange failures, visible in the Vercel runtime logs.

## [0.4.0] - 2026-07-22

### Added

- **Edit saved Connected Apps** — update a Connected App's label, login URL,
  consumer key, and (optionally) rotate the consumer secret without deleting and
  re-creating it. Leaving the secret blank keeps the existing one.
- **Rename connections** — give saved org connections a friendly name.
- Endpoints: `PATCH /api/salesforce/apps/:id`, and a `rename` action on
  `PATCH /api/salesforce/connections/:id`.

## [0.3.1] - 2026-07-22

### Fixed

- **App unlock**: `APP_PASSWORD` and the submitted password are now trimmed, so a
  trailing newline/space in the environment variable (a common paste artifact)
  no longer causes a silent "invalid password".
- The unlock endpoint now returns a clear, specific message when `APP_PASSWORD`
  is not configured on the deployment, instead of a generic failure.

## [0.3.0] - 2026-07-22

### Added

- **In-app Connected App setup** — register Salesforce OAuth credentials (login
  URL, consumer key, consumer secret) on a new **Connections** page instead of
  environment variables. Client secrets are AES-256-GCM encrypted at rest.
- **Multiple saved connections** — connect several orgs, see them listed, switch
  the active connection, and disconnect individually. The active connection is
  used by the SOQL runner, object explorer, and Bulk tools.
- New `salesforce_oauth_apps` table and `oauth_app_id` link on connections
  (migration `0002_oauth_apps_multi_connection.sql`).
- REST endpoints: `GET/POST /api/salesforce/apps`, `DELETE /api/salesforce/apps/:id`,
  `GET /api/salesforce/connections`, `PATCH/DELETE /api/salesforce/connections/:id`.

### Changed

- OAuth login/callback now select the Connected App by id; token refresh uses the
  per-connection app credentials. `SALESFORCE_CLIENT_ID/SECRET/LOGIN_URL` env vars
  are no longer required.

## [0.2.0] - 2026-07-22

### Added

- **Bulk API 2.0 export** — start a query job, poll to completion, and download
  the full result set as CSV (paginated via `Sforce-Locator`). Handles datasets
  larger than the standard REST query limit.
- **Bulk API 2.0 import** — insert / update / upsert / delete / hard-delete via
  ingest jobs. Upload a CSV (file picker or paste), pick the object and
  operation (external ID field for upsert), then poll job status and download
  the successful / failed record results.
- New **Bulk** page and navigation entry.

## [0.1.0] - 2026-07-21

### Added

- Initial application scaffold: Next.js 14 (App Router) + TypeScript, deployable to Vercel.
- Single-user app-auth gate (`APP_PASSWORD`) with a signed, httpOnly session cookie.
- Salesforce OAuth 2.0 Web Server (authorization code) connect flow with CSRF state protection.
- Refresh tokens encrypted at rest with AES-256-GCM before storage in Supabase.
- Supabase schema (`salesforce_connections`, `sf_metadata_cache`) with RLS locked down.
- SOQL query runner with paginated fetch and a results grid.
- Object explorer with global describe + per-object field metadata, cached in Supabase (24h TTL).
- CSV export of query results.
- Automatic access-token refresh and instance-URL tracking.

### Coming next

- Bulk API 2.0 export for large datasets.
- Bulk API 2.0 import / upsert.
