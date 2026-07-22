# Changelog

All notable changes to Salesforce Data Explorer are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

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
