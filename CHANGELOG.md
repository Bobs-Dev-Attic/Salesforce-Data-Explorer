# Changelog

All notable changes to Salesforce Data Explorer are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.43.0] - 2026-07-24

### Added

- **Excel-style Data Explorer view** — a toggle (**▦ Excel view** / **Classic
  view**) switches the Data Explorer into a Microsoft-Excel-like skin, remembered
  in localStorage (`sfde.explorer.view`). It reuses all the existing builder
  logic and just re-presents it:
  - A green **title/quick-access bar**, a **ribbon** with tabs (**Home / Data /
    View**) and grouped commands (Run, Export, Copy, Open/Save, Object picker,
    Columns ▾ and Filter ▾ dropdown panels, Sort / Direction / Limit).
  - A **formula bar** with a Name Box (shows the active cell's A1 reference, e.g.
    `C5`) and the generated SOQL (or the selected cell's value).
  - A **spreadsheet grid**: column-letter header (A, B, C…), a frozen field-name
    header, row numbers, gridlines, click-to-select cells, and sticky
    headers/row-gutter. Large results stay virtualized.
  - **Sheet tabs** and a green **status bar** showing record count and, for a
    selected column, Count / Sum / Average.
- New pure helper `src/lib/colLetter.ts` (`colLetter`, `cellRef`; 5 tests) and
  presentational component `src/components/ExcelDataView.tsx`. Self-contained
  light skin — no new runtime dependencies; the Classic view is unchanged.

## [0.42.1] - 2026-07-24

### Fixed

- **Stale page after deploy** — the middleware now sends
  `Cache-Control: no-store, must-revalidate` on page documents, so a browser
  refresh always fetches the current deploy instead of a cached HTML shell that
  points at old asset chunks. Scoped to the middleware matcher (page documents
  only); hashed `/_next/static` assets keep their immutable caching. As a bonus,
  authed page HTML is no longer retained in the browser cache after logout.

## [0.42.0] - 2026-07-24

### Changed

- **Data Explorer layout reworked** into a tighter, single-row builder:
  - The **Object** picker now lives at the top of the **Columns** section (its
    own card is gone).
  - **Saved queries**, **Columns**, and **Filters** sit together in one
    three-column row (stacks on narrow screens).
  - **Saved queries** and **Generated SOQL** are now **collapsible** (chevron
    toggle; collapsed state remembered in localStorage).
  - Clicking a saved query opens a **confirmation dialog** before loading (it
    replaces the current builder), and when the current query isn't already
    saved it offers **"Save current & load"** so you don't lose unsaved work.
  - The results table's **Download** button is replaced by the shared **Export ▾**
    dropdown (CSV / Tab-delimited / Excel / JSON), matching the SOQL Editor.

## [0.41.0] - 2026-07-24

### Added

- **Resizable result-table columns** on the Data Explorer, SOQL Editor, and
  Object Explorer. Drag the handle on a column header's right edge to set its
  width; widths are keyed by column name and **persisted to localStorage** per
  surface (`sfde.soql.colwidths`, `sfde.explorer.colwidths`,
  `sfde.objects.colwidths`), so they survive reloads.
  - Widths are also **saved into Saved queries** — when you save a SOQL Editor
    or Data Explorer query, its current column widths ride along in the query's
    `builder_state` and are restored when you reload it.
  - Tables use `table-layout: fixed` with a `<colgroup>`; data cells clip with
    an ellipsis, while headers stay overflow-visible so the sort/filter
    controls and the resize handle aren't clipped.
- New pure-helper hook `src/lib/useColumnWidths.ts` (`nextWidth`, `totalWidth`,
  drag-to-resize via pointer events; 6 tests).

## [0.40.0] - 2026-07-24

### Added

- **"New" indicator on a just-saved query** — after you save a query in the SOQL
  Editor, its entry in the **Saved** list flashes a green **New** badge plus a
  subtle row highlight that **fade out over 60 seconds**, so it's easy to spot
  which one you just added. Respects `prefers-reduced-motion` (static highlight,
  no fade) and clears itself after 60s.

## [0.39.1] - 2026-07-24

### Changed

- **Autocomplete on mobile** — the suggestion popup now shows just the
  field/object name on narrow screens (≤ 820 px); the type + label detail
  (e.g. "string · Account Number") is hidden there to avoid a cramped, wrapped
  row. Wider screens keep the full detail.

## [0.39.0] - 2026-07-24

### Added

- **Quick-fixes in the SOQL Editor** — diagnostics can now carry a one-click fix,
  shown as an action button beside the message in the problems bar. Applying it
  edits the query and re-lints. Sources:
  - **Missing comma** (client, before you Run) — `SELECT Name AccountNumber …`
    is flagged as *"Missing comma before 'AccountNumber'?"* with an **Insert
    comma** fix. This is exactly the case Salesforce rejects with *"only
    aggregate expressions use field aliasing"* (it reads the second field as an
    alias). Detection is conservative: SELECT list only, skips aggregate queries
    (where aliasing is legal), subqueries, and functions.
  - **"Did you mean…"** for a mistyped field (client) — an unknown field is
    matched against the object's cached describe using Damerau-Levenshtein
    (transpositions count as one edit), e.g. `Naem` → **Use 'Name'**.
  - **Server-error → fix** (after **Check ✓**) — the aggregate-aliasing error
    maps to an **Insert comma** at Salesforce's reported `Row:Column`, and
    `INVALID_FIELD: No such column 'X'` maps to a **Use '<nearest>'** fix.
- New pure helper `src/lib/fuzzy.ts` (Levenshtein + OSA distance + `nearest`, 8
  tests); `parseInvalidField` / `isMissingCommaError` in `src/lib/sfError.ts`.

## [0.38.0] - 2026-07-24

### Fixed

- **Mobile responsiveness** — on phones the top navigation (connection pill + six
  section links + menu) was a single non-wrapping row wider than the viewport,
  which forced a horizontally-scrollable page; mobile browsers responded by
  zooming out, cramming all content into a narrow left column with dead space on
  the right. The section links now **collapse behind a hamburger** (`PrimaryNav`)
  on ≤ 820 px, the connection pill and brand shrink, the editor toolbar wraps,
  and `html/body` get `overflow-x: hidden` as a safety net. The page now fills
  the screen on mobile.
- **New-line key in the SOQL editor** — when the autocomplete popup was open,
  Enter always accepted the highlighted suggestion, so it could never insert a
  line break (especially painful on mobile, where the popup is usually open).
  Enter now **inserts a newline unless you've navigated the list** with the arrow
  keys; **Tab** (and click) still accept the suggestion.

## [0.37.0] - 2026-07-24

### Added

- **Auto-format** — a **Format** button in the SOQL Editor reflows the query
  into a canonical multi-line layout: each top-level clause on its own line, the
  `SELECT` field list one field per indented line, and top-level `AND`/`OR` in
  `WHERE` broken onto indented lines. Pure engine `src/lib/soqlFormat.ts` (9
  tests) — it only moves whitespace and uppercases the structural keywords it
  anchors on; it never rewrites operators, field names, or string literals, and
  leaves parenthesised subqueries on one line (idempotent; non-SELECT input is
  returned untouched).
- **Line-wrap toggle** — a **Wrap** checkbox soft-wraps long lines in the editor
  (the line-number gutter hides while wrapped, since per-line numbering can't
  stay aligned across wrapped rows). Off by default; the choice is remembered.

### Changed

- **Autocomplete now debounced** — the suggestion popup appears after a short
  (~130 ms) pause instead of on every keystroke, and a **stale-caret guard**
  suppresses a popup whose anchor no longer matches the caret (e.g. the caret
  moved while describe metadata was still loading). The caret-position helper
  (`caretCoords.ts`) now honors the editor's wrap mode.

## [0.36.0] - 2026-07-24

### Added

- **SOQL server-side validation (intellisense), Phase 3** — a **Check ✓** button
  in the SOQL Editor validates the query authoritatively against Salesforce
  **without running it**, using the Query Explain endpoint
  (`/query/?explain=…`), which plans the query (objects, fields, relationships,
  syntax) and returns zero rows.
  - A valid query shows **"Valid — Salesforce accepted this query"**.
  - An invalid query is surfaced inline: the Salesforce error is mapped through
    `friendlyError`, and its `Row:Column` location (parsed by the new
    `parseSoqlErrorLocation`) anchors a red underline on the exact token plus a
    clickable entry in the problems bar. This catches what the client-side
    linter can't — relationship-field validity, FLS/permission errors, and
    Salesforce's own malformed-query diagnostics.
- New route `POST /api/salesforce/validate` (`runtime="nodejs"`,
  `isAuthenticated()`), and `parseSoqlErrorLocation` in `src/lib/sfError.ts`
  (3 new tests). The stale server result clears automatically as you edit.

## [0.35.0] - 2026-07-24

### Added

- **SOQL inline validation (intellisense), Phase 2** — the SOQL Editor now lints
  as you type, drawing wavy underlines under problems and listing them in a
  clickable "problems" bar (jump-to-location) under the editor. No new runtime
  dependencies. Checks:
  - **Structural** (always on): unterminated string literals and unbalanced
    parentheses, with the exact offset underlined.
  - **Unknown object** after `FROM`, validated against the cached global object
    list (error).
  - **Unknown fields** in `SELECT` / `WHERE` / `ORDER BY` / `GROUP BY`, validated
    against the FROM object's cached describe (warning).
  - Conservative by design: relationship paths, function calls, and aggregate
    aliases are skipped; field checks **bail entirely on subqueries / `TYPEOF`**
    where a client-side field list can't be authoritative; and the identifier
    **currently under the caret is never flagged** (you're still typing it).
    Authoritative server-side validation remains Phase 3.
- New pure, unit-tested engine `src/lib/soqlLint.ts` (structural + semantic
  diagnostics with source offsets and 1-based line/col, 19 tests).

## [0.34.0] - 2026-07-24

### Added

- **SOQL autocomplete (intellisense), Phase 1** — the SOQL Editor now pops a
  context-aware suggestion menu as you type, with no new runtime dependencies:
  - **Objects** after `FROM` (from the cached global object list).
  - **Fields** in `SELECT` / `WHERE` / `ORDER BY` / `GROUP BY` (from the object's
    cached describe), with type + label detail.
  - **Relationship traversal** — a dotted token (`Account.Nam…`, and multi-hop
    `Account.Owner.…`) resolves the lookup target via `referenceTo` and suggests
    that object's fields.
  - **Picklist values** inside a quoted comparison (`Industry = 'Ban…`, `IN ('…`).
  - **Keyword** help between clauses.
  - Keyboard driven: ↑/↓ to move, Enter/Tab to accept, Esc to dismiss; mouse
    hover/click also work. ⌘/Ctrl+Enter still runs the query. Caret-anchored
    popup positioned via a hidden-mirror measurement.
- New pure, unit-tested engine `src/lib/soqlComplete.ts` (context analysis +
  ranking, 22 tests) and caret helper `src/lib/caretCoords.ts`. Metadata is
  fetched lazily from the existing describe endpoints and cached per object on
  the client.

## [0.33.0] - 2026-07-23

### Added

- **Tab-delimited (.tsv) export** everywhere — added a "Tab-delimited" option to
  the SOQL Editor and Data Explorer exports (streamed via a shared delimiter in
  `src/lib/csv.ts`, `text/tab-separated-values`), alongside CSV / Excel / JSON.
- **Bulk export format picker** — the Bulk API export "Download" is now a
  dropdown offering **CSV / Tab-delimited / JSON / Excel**. The results route
  (`bulk/query/[jobId]/results?format=…`) converts the assembled CSV to the
  chosen format (CSV stays a passthrough; TSV/JSON/XLSX are parsed + rebuilt).
- Generalized the delimited serializers (`delimitedCell/Header/Row`,
  `matrixToDelimited`) with TSV unit tests (73 total). CSV keeps the same
  formula-injection hardening; TSV quotes values containing a tab/quote/newline.

## [0.32.0] - 2026-07-23

### Changed

- **Bulk import CSV off the JSON body (P2)** — the import CSV was sent as a
  string inside a JSON envelope, doubling memory and hitting Vercel's ~4.5 MB
  request limit sooner. It now rides as the **raw `text/csv` request body** with
  metadata in query params (`POST /api/salesforce/bulk/ingest?object=…&operation=…`).
- **Large imports now chunk automatically** — the client splits the CSV into
  LF-joined chunks under the body limit (`splitCsvIntoChunks`, never splitting a
  record, header repeated per chunk) and runs each as its own sequential ingest
  job, showing progress (`part 2 of 5…`) and aggregating results — total
  processed/failed plus per-job Successful/Failed CSV links. Lifts the practical
  import-size ceiling well beyond a single 4.5 MB request.
- New `rawCsvRecords` / `splitCsvIntoChunks` in `src/lib/csv.ts` with unit tests
  (69 total).

## [0.31.0] - 2026-07-23

### Added

- **Bulk import dry-run preview** — before running an import you can now
  **Preview import**: `POST /api/salesforce/bulk/preview` analyzes the CSV
  against the org and reports what *would* happen — **X insert / Y update /
  Z delete / N not-found** — without touching data. It validates columns
  against the object's fields (flags unknown columns), and for update/delete
  looks up which `Id`s exist, for upsert which external-ID values match. A
  **Download report** button saves the summary, and **Approve & run import**
  proceeds (destructive ops still require the typed confirmation). Existence
  checks are capped at 10,000 rows (reported when truncated).
- **Object picker on the import form** — the "Object (API name)" field is now
  the same searchable combobox + directory dialog used elsewhere (recents,
  browse-all), instead of a plain text input.
- New `parseCsv` (RFC-4180-ish: quotes, escaped quotes, embedded newlines) in
  `src/lib/csv.ts`, with unit tests (65 total).

## [0.30.0] - 2026-07-23

### Added

- **Friendly error messages (P2)** — Salesforce/OAuth errors were surfaced as
  raw JSON. New `src/lib/sfError.ts#friendlyError` parses the common error
  shapes (REST `[{message,errorCode}]`, OAuth `{error,error_description}`,
  plain strings), extracts the useful message (incl. the real line out of a
  multi-line SOQL error), and adds an actionable hint for common codes
  (`INVALID_FIELD`, `MALFORMED_QUERY`, `INVALID_SESSION_ID`, `invalid_grant`, …).
  - New `ErrorNotice` component renders the headline + hint + error-code tag,
    with **Copy details** and a collapsible raw payload so precision is kept.
  - Wired into the SOQL Editor, Data Explorer, and Bulk tools.
  - 7 new unit tests (60 total).

## [0.29.0] - 2026-07-23

### Added

- **Env validation + health route (P2)** — new `src/lib/env.ts` centralizes
  environment checks: `assertEnv()` fails fast with one aggregated message
  listing every missing/invalid required var, and `checkEnv()` reports config
  health without exposing secret *values*.
  - **`GET /api/health`** — returns `{ ok }` + HTTP `200`/`503` for uptime
    monitors; an unlocked session additionally gets the per-variable report
    (names + presence/validity) for diagnosis.
  - Wired `assertEnv()` into the login route: once the password is correct, a
    misconfigured deployment returns a clear `503` instead of a deep `500` from
    the cookie/DB calls.
  - Validates `APP_PASSWORD`, `APP_SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
    `NEXT_PUBLIC_SUPABASE_URL` (URL shape), and the encryption keyring; flags
    `APP_BASE_URL` as recommended. 7 new unit tests (53 total).

## [0.28.0] - 2026-07-23

### Security

- **Session revocation (P2)** — sessions are now revocable. A server-side
  **session epoch** (Supabase `app_settings`, migration `0004`) is embedded in
  the signed cookie (`expiryMs.epoch.hmac`); `isAuthenticated()` rejects any
  cookie whose epoch ≠ the current one. A new **App menu → "Sign out all
  sessions"** (`POST /api/app-auth/revoke-all`) bumps the epoch, immediately
  invalidating every outstanding session (including the current one) without a
  redeploy or secret rotation.
  - The epoch is cached in-memory (30 s TTL) to avoid a DB read per auth check;
    revocation propagates to other warm instances within that window.
  - `isAuthenticated()` / `createSessionCookie()` are now async (all ~30 call
    sites updated). **Note:** the cookie format changed, so existing sessions
    are invalidated once on deploy and must unlock again.
  - 6 new session-revocation unit tests (46 total).

## [0.27.0] - 2026-07-23

### Accessibility (P2)

- **Schema map is now keyboard-navigable** — each related-object node in the SVG
  relationship map is a focusable `role="button"` with an `aria-label`,
  activatable via Enter/Space, and a visible focus ring (thicker node stroke).
  The `<svg>` carries a descriptive `aria-label` summarizing the map.
- **Object directory dialog** now traps focus, closes on Escape, and restores
  focus on close (`useFocusTrap`), with `role="dialog"` + `aria-modal`; its rows
  are keyboard-activatable buttons.
- **Object Explorer field rows** are keyboard-focusable and open the metadata
  dialog via Enter/Space, with an `aria-label` and inset focus ring.
- Converted the schema map's "Show all/fewer" link from an `<a href="#">` to a
  real button.

This completes the targeted a11y items (modals, SVG schema map, focus rings,
aria-labels). Remaining a11y follow-ups tracked in `TODO.md`: a full WAI-ARIA
tree pattern (arrow-key nav) for the Object Explorer tree, and an automated axe
check in CI.

## [0.26.0] - 2026-07-23

### Added

- **Encryption key rotation (P2)** — `crypto.ts` now uses a versioned **keyring**
  instead of a single key. Each key has a short id; new data is encrypted with
  the *active* key while any key in the ring can decrypt, enabling zero-downtime
  rotation. Ciphertext is now `keyId:iv:authTag:ciphertext`; legacy 3-segment
  payloads still decrypt (treated as key `v1`), so existing data is unaffected.
  - New optional env vars: `CREDENTIALS_ENCRYPTION_KEYS` (`id:base64,…`) and
    `CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID`. `CREDENTIALS_ENCRYPTION_KEY` is
    unchanged (the primary key, id `v1`).
  - **Re-encrypt migration** — `src/lib/keyRotation.ts` + `POST /api/admin/rekey`
    (app-auth gated, idempotent) rewrite all stored secrets under the active key.
    Triggerable in-app from **App menu → “Re-encrypt secrets”**.
  - 13 new crypto/rotation unit tests (40 total).

## [0.25.0] - 2026-07-23

### Added

- **Virtualized result grids (P2)** — the SOQL Editor and Data Explorer result
  tables now window their rows (`src/lib/useVirtualRows.ts`): only the rows near
  the viewport (plus overscan) render to the DOM, with spacer rows padding the
  scroll height. Kicks in past ~150 rows; smaller results render in full as
  before. Keeps large (up to 2,000-row) result sets responsive.
- **SOQL Editor export dropdown** — the export control is now a single
  **Export ▾** dropdown button (`src/components/ExportMenu.tsx`) listing CSV /
  Excel / JSON; choosing a format runs the export directly. Closes on outside
  click or Escape.

### Accessibility (P2)

- Modal dialogs (field metadata, destructive-op confirmation) now **trap focus**,
  close on **Escape**, and **restore focus** to the trigger on close
  (`src/lib/useFocusTrap.ts`), with `role="dialog"` + `aria-modal`.
- Added a global keyboard **focus-visible ring** and `aria-label`s on icon-only
  buttons that lacked them.

## [0.24.0] - 2026-07-23

### Changed

- **Streamed CSV/JSON exports (P2)** — the export route previously buffered the
  entire result set (up to 50k rows) in serverless memory before responding,
  risking OOM on large/wide datasets. CSV and JSON now stream page by page via a
  new `streamSoql` async generator and a `ReadableStream`, holding just one
  Salesforce batch in memory at a time. Columns are fixed from the first batch
  (SOQL's SELECT determines the schema). A bad query still surfaces as a clean
  `400` because the first page is fetched before the streaming `200` is
  committed. XLSX stays buffered (a ZIP needs the full matrix up front).

### Added

- `csvHeader` / `csvRow` helpers in `src/lib/csv.ts` for row-at-a-time
  serialization, with unit tests (32 tests total).

## [0.23.0] - 2026-07-23

### Added

- **Destructive-op confirmation (P2)** — Bulk **Delete** and **Hard delete**
  imports now require an explicit confirmation: a modal shows the operation, the
  target object, and the CSV row count, and the confirm button stays disabled
  until you type the exact object name. Hard delete carries an extra
  "permanent / bypasses Recycle Bin" warning. Non-destructive ops (insert /
  update / upsert) run as before. The Run button turns red and relabels for
  destructive operations.

### Fixed

- **SOQL Editor light-mode contrast** — the editor was hardcoded to a dark
  background while its base (non-keyword) text used the theme text color, which
  turned dark in light mode → unreadable columns. The editor now uses dedicated,
  theme-aware variables: in light mode a white background with dark text and
  high-contrast keyword/string/number colors; dark mode is unchanged.

### Added

- **MIT LICENSE (P1)** — added an MIT `LICENSE` file and a `license` field in
  `package.json`, resolving the legal/compliance gap flagged in the review.

## [0.22.0] - 2026-07-23

### Added

- **Automated tests (P1)** — introduced Vitest with 28 unit tests covering the
  security- and correctness-critical helpers: `crypto` encrypt/decrypt
  round-trip + auth-tag tamper rejection, `session` `checkPassword` /
  `isPasswordConfigured`, the login `rateLimit` lockout logic + `clientIp`
  parsing, and CSV serialization incl. formula-injection escaping. Run with
  `npm test`.
- **Continuous integration (P1)** — added `.github/workflows/ci.yml` running
  typecheck → lint → test → build on every PR and push to `main`, closing the
  gap where changes merged with no automated gate.
- **ESLint config** — added `.eslintrc.json` (`next/core-web-vitals`) so
  `npm run lint` runs non-interactively in CI (clean on the current tree).

### Changed

- Extracted CSV serialization into `src/lib/csv.ts` (from the export route) so
  the escaping rules are unit-testable; the route now imports `toCsv`. No
  behavior change.

## [0.21.0] - 2026-07-23

### Performance

- **Access-token caching (P1)** — `getAccessToken` previously ran a full
  `refresh_token` / `client_credentials` grant on *every* Salesforce call, so a
  single object explore or export fanned out into many token requests. Tokens
  are now cached in memory per connection until shortly before expiry (honoring
  `expires_in` when returned, else a configurable `SF_TOKEN_TTL_SECONDS` default
  of 15 min, minus a 60 s skew). `sfFetch` and the Bulk API fetch helper
  invalidate and re-mint once on a `401`, so a token that expires early (session
  revoked / short org timeout) self-heals. `disconnect` clears the cache.
  New optional env var: `SF_TOKEN_TTL_SECONDS`. (Cache is per warm serverless
  instance; a shared/persisted cache remains a possible follow-up.)

## [0.20.0] - 2026-07-23

### Security

- **Login rate limiting (P0)** — `POST /api/app-auth/login` now enforces a
  per-IP limiter (`src/lib/rateLimit.ts`): 5 failed attempts in a 15-minute
  window trigger a 15-minute lockout, returning `429` with a `Retry-After`
  header. Successful logins clear the counter. This closes the unlimited
  brute-force window against the shared `APP_PASSWORD`. (In-memory/per-instance
  baseline; a durable Redis/WAF limiter remains tracked in `TODO.md`.)
- **Security headers + Content-Security-Policy (P1)** — added a nonce-based CSP
  via `src/middleware.ts` (`default-src 'self'`, `strict-dynamic` scripts,
  `frame-ancestors 'none'`, `object-src 'none'`, `upgrade-insecure-requests`)
  and static headers in `next.config.js` (`X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  HSTS). The inline theme-init script now carries the request nonce.
- **CSV formula-injection hardening (P1)** — `export/route.ts#csvCell` now
  prefixes cells beginning with `= + - @` (or tab/CR) with a single quote so
  exported CSVs can't execute as formulas in Excel / Google Sheets. The XLSX
  path already used `inlineStr` and was unaffected.

## [0.19.1] - 2026-07-23

### Added

- **Project documentation & review** — added a full documentation set to help
  humans and coding agents orient without re-scanning the codebase:
  - `docs/ARCHITECTURE.md` — stack, trust model, directory map, data model,
    localStorage keys, key flows, deploy/versioning workflow, env vars.
  - `docs/REVIEW.md` — candid multi-perspective critique (security/pentester,
    software engineer, UX, legal/privacy, marketer/founder) with P0–P3 severity.
  - `TODO.md` — prioritized backlog (P0–P3) distilled from the review.
  - `SECURITY.md` — threat model, trust boundaries, data-handling posture,
    known gaps, and secret/env guidance.
  - `AGENTS.md` and `CLAUDE.md` — agent guides (conventions, ship workflow,
    gotchas, infra IDs) to minimize token use and rework.

## [0.19.0] - 2026-07-23

### Added

- **Object record counts** — the Object Explorer now shows an approximate record
  count badge on each object (via Salesforce's `/limits/recordCount`, one cached
  call for all objects) and a **Sort: Name / Records** toggle to order objects by
  count. A ↻ button refreshes the counts. New `GET /api/salesforce/record-counts`.

## [0.18.0] - 2026-07-23

### Added

- **Light / dark theme toggle** — switch themes from the new top-bar **menu**;
  the choice persists in `localStorage` and is applied before first paint (no
  flash). Colors are driven by CSS variables, so the whole app re-themes.
- **Top-bar menu (☰)** — declutters the nav by housing the theme toggle,
  **Connections**, and **Lock**.

## [0.17.0] - 2026-07-23

### Added

- **Active-connection switcher** in the top bar — shows the active Salesforce org
  on every page (Data Explorer, SOQL, Objects, Schema, Bulk, …). When more than
  one connection is saved, a dropdown lets you switch; activating reloads so all
  data re-reads from the newly-selected org.

## [0.16.1] - 2026-07-23

### Added

- **Object directory button** — a 🗂️ icon beside the object fields (Data Explorer
  and Schema) opens a searchable dialog listing all objects (Recent, Standard,
  Custom) to pick from.
- The object autocomplete now surfaces **recently selected objects first**.

### Fixed

- The object field could not be fully cleared (deleting the last character
  snapped back to the selected name). Replaced with a single controlled combobox
  (`ObjectPicker`) so typing/clearing behaves normally.

## [0.16.0] - 2026-07-23

### Added

- **Schema tab** — an interactive relationship map. Pick an object to place it at
  the center; its **parent (lookup)** objects render on the left and **child**
  objects on the right, connected by curved SVG edges (hover an edge/node for the
  relationship fields). **Click any related object to re-center** and walk the
  schema. Parent lookups are grouped by target object; child relationships beyond
  22 collapse behind a "Show all". Dependency-free inline SVG.

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
