# Changelog

All notable changes to Salesforce Data Explorer are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.15.0] - 2026-07-23

### Added

- **Data Explorer results grid** now matches the Object Explorer: click a column
  header to **sort** (asc/desc, numeric-aware), and use the **funnel-icon column
  filters** to narrow rows.
- **Field metadata dialog** in the Data Explorer — an **ⓘ** button next to each
  field in the column picker opens the same two-column metadata dialog.

### Changed

- Extracted the shared `FunnelIcon` and `FieldMetadataDialog` into
  `src/components/fieldUi.tsx`, reused by both explorers for consistent styling.

## [0.14.1] - 2026-07-22

### Changed

- Field metadata dialog now lays out properties in a **two-column grid** (single
  column on narrow screens). Picklist values and nested-object properties span
  the full width.

## [0.14.0] - 2026-07-22

### Added

- **Field metadata dialog** in the Object Explorer — click a field (in the tree
  or the details table) to open a modal showing its full describe metadata
  (type, length/precision, nillable, createable/updateable, unique, external id,
  custom, default value, reference targets, relationship name, help text,
  picklist values, and every other property). Closes on backdrop click, ✕, or
  Escape.

## [0.13.0] - 2026-07-22

### Added

- **App-wide loading indicators** — a thin animated **progress bar** at the top
  of the screen and a small **"Working…" pill** appear automatically whenever any
  API request is in flight (queries, describes, bulk job polling, exports, saves,
  connections). Implemented by wrapping `fetch` once, so every request drives it,
  complementing the existing per-button "Running…"/"Loading…" states.

## [0.12.1] - 2026-07-22

### Changed

- Object Explorer fields table: column filtering is now a **funnel icon** next to
  each column header that opens a **filter flyout** (input + Clear), instead of an
  always-visible filter row. The funnel highlights when a column is filtered, and
  the flyout closes on outside click / Enter / Escape.

## [0.12.0] - 2026-07-22

### Added

- **Sortable, filterable fields table** in the Object Explorer details pane:
  click any column header (Label, API name, Type, Details) to sort
  ascending/descending, and use the per-column filter row to narrow the fields.
  A count shows matching vs total fields.

## [0.11.1] - 2026-07-22

### Added

- **Full tree-state persistence** in the Object Explorer — which folders,
  objects, and Fields/Child-Relationships sub-nodes are expanded is now saved to
  `localStorage` and restored on return (surviving logout/session timeout), so
  the tree reopens exactly as you left it. Expanded objects auto-load their
  describes on restore.

## [0.11.0] - 2026-07-22

### Changed

- **Object Explorer redesigned as a Windows-Explorer-style tree**: collapsible
  **Standard Objects** / **Custom Objects** folders → objects → expandable
  **Fields** and **Child Relationships** nodes (with type icons). Selecting an
  object shows its full field table in a details pane. Filter box and last
  selection persist across sessions.

## [0.10.0] - 2026-07-22

### Added

- **SOQL syntax highlighting** in the SOQL editor — keywords, string literals,
  and numbers are colorized via a highlighted overlay synced to the textarea
  (caret and selection still native).
- **Persistent page state** — the Data Explorer (full builder), SOQL editor
  (query + row limit), Objects (selected object + filter), and Bulk (export
  SOQL, import object/operation/external-id) now remember your working state in
  `localStorage`. It survives navigation, **logout, and session timeout**, and
  is restored when you return.

## [0.9.0] - 2026-07-22

### Changed

- **SOQL page redesigned as a SQL-editor-style workspace** (inspired by the
  Supabase SQL editor): a left sidebar with **saved queries** and **templates**,
  a toolbar with a **row-limit** dropdown and **Run** (⌘/Ctrl+Enter), a code
  editor with a **line-number gutter**, and a bottom results panel with a
  **status line** and **export menu** (CSV / Excel / JSON). Saved queries reuse
  the `saved_queries` store shared with the Data Explorer.

## [0.8.0] - 2026-07-22

### Added

- **Relationship fields in the Data Explorer**:
  - **Parent (lookup) fields** — expand any reference field to pick fields from
    the related object (e.g. `Owner.Name`, `Account.Industry`) as columns and
    filters.
  - **Child relationships (subqueries)** — expand a child relationship and pick
    fields to add a `(SELECT … FROM ChildRel)` subquery to the SELECT.
  - Results are flattened for display (dotted parent columns; child subqueries
    shown as a row count).
- **Saved queries** — save the full builder state (object, columns, filters,
  related/child fields, order, limit) plus the generated SOQL under a name, then
  reload or delete them. New `saved_queries` table (migration
  `0003_saved_queries.sql`) and `/api/salesforce/saved-queries` endpoints. If the
  table isn't migrated yet, the Explorer still works and shows a hint.

## [0.7.0] - 2026-07-22

### Added

- **Type-aware filter inputs** in the Data Explorer: **date** and
  **datetime** pickers for date fields, **dropdowns** for picklist fields
  (single-select, or multi-select for `IN` / `NOT IN`), a true/false dropdown
  for booleans, and numeric inputs for number fields. SOQL datetime literals
  are normalized automatically.
- **Multi-format export** on the results: choose **CSV**, **Excel (.xlsx)**, or
  **JSON** and download. Excel files are produced by a small, dependency-free
  OOXML/ZIP writer (`src/lib/xlsx.ts`). The export endpoint now accepts a
  `format` parameter.

## [0.6.0] - 2026-07-22

### Added

- **Data Explorer** — a visual query builder. Pick a queryable object from a
  searchable list, check the columns to return, add filter rows (field /
  operator / value, combined with AND or OR), and set order-by and limit. The
  **SOQL is generated live** as you build, with Copy, Run, and Export-CSV
  actions. Values are quoted per field type automatically. New **Explorer** nav
  tab and dashboard button. Reuses the existing describe + query endpoints, so
  no backend or schema changes.

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
