# Architecture

> Read this before scanning the codebase. It exists so agents (and humans) can
> orient without re-deriving the map. ~6,900 LOC, Next.js App Router.

## Stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------ |
| Framework  | Next.js 14 (App Router), React 18, TypeScript                |
| Hosting    | Vercel (Node.js serverless runtime for all route handlers)   |
| Database   | Supabase Postgres (project `wdrewwsxbtovikgudenj`)           |
| Salesforce | REST API v61.0 + OAuth 2.0 + Bulk API 2.0                    |
| Styling    | Hand-rolled CSS variables in `src/app/globals.css` (no UI lib)|

Single-user app. There is **no per-user auth** — the whole app is gated by one
password (`APP_PASSWORD`). Everything server-side reaches Supabase with the
**service-role key**; RLS is enabled with no policies so the anon key sees nothing.

## Request/trust model

```
Browser ──(APP_PASSWORD)──▶ signed httpOnly cookie ──▶ Next route handlers
   route handlers ──(service role key)──▶ Supabase (tokens, metadata cache, saved queries)
   route handlers ──(per-connection access token)──▶ Salesforce REST/Bulk
```

- App auth: `src/lib/session.ts` — HMAC-signed cookie `sfde_session = "<expiryMs>.<hmac>"`, 7-day expiry, `httpOnly`+`secure`(prod)+`SameSite=lax`. Verified by `isAuthenticated()` in every page/route.
- Salesforce auth: OAuth 2.0 Web Server flow **or** Client Credentials flow. Refresh tokens and Connected App client secrets are **AES-256-GCM encrypted at rest** (`src/lib/crypto.ts`) before hitting Supabase.

## Directory map

```
src/lib/
  crypto.ts            AES-256-GCM encrypt/decrypt (key: CREDENTIALS_ENCRYPTION_KEY)
  session.ts           app-auth cookie sign/verify, checkPassword
  supabase.ts          server-only service-role client (singleton)
  salesforce.ts        OAuth apps CRUD, connections CRUD, token mint, sfFetch,
                       runSoql, describeGlobal/SObject (+ 24h Supabase cache),
                       getRecordCounts
  bulk.ts              Bulk API 2.0: query jobs + ingest jobs
  savedQueries.ts      saved_queries CRUD (graceful if table missing)
  xlsx.ts              dependency-free OOXML/ZIP writer (CRC32 + stored ZIP)
  csv.ts               CSV serialization + formula-injection escaping
  rateLimit.ts         in-memory per-IP login limiter (lockout)
  usePersistentState.ts localStorage-backed useState hook

Tests: Vitest, colocated as src/**/*.test.ts (crypto, session, rateLimit, csv).
CI: .github/workflows/ci.yml runs typecheck → lint → test → build on PRs.

src/app/api/           route handlers (all runtime="nodejs", all isAuthenticated())
  app-auth/{login,logout}
  auth/salesforce/{login,callback}      OAuth authorize + code exchange
  salesforce/apps[/id]                   Connected App CRUD
  salesforce/connections[/id]            connection list / activate / rename / delete
  salesforce/connect-client-credentials  server-to-server connect
  salesforce/query                       SOQL runner
  salesforce/objects[/name]              describeGlobal / describeSObject
  salesforce/record-counts               /limits/recordCount
  salesforce/export                      CSV / XLSX / JSON export
  salesforce/bulk/{query,ingest}/...     Bulk API 2.0
  salesforce/saved-queries[/id]          saved builder state + SOQL
  salesforce/debug                       diagnostics (app-auth gated, no secrets)

src/app/*/page.tsx     pages: / (dashboard), /login, /explorer, /query, /objects,
                       /schema, /bulk, /connections
src/components/        DataExplorer, QueryRunner (SOQL editor), ObjectExplorer (tree),
                       RelationshipMap (schema SVG), BulkTools, ConnectionsManager,
                       ObjectPicker, ConnectionSwitcher, AppMenu, GlobalProgress,
                       fieldUi (shared FunnelIcon + FieldMetadataDialog)
```

## Data model (Supabase, `public`)

- `salesforce_oauth_apps` — Connected App creds (`client_secret_encrypted`).
- `salesforce_connections` — org connections (`refresh_token_encrypted`, `is_active`, `oauth_app_id`). Client-credentials connections store a sentinel refresh token.
- `sf_metadata_cache` — describe/global/recordCount payloads (jsonb), keyed `(connection_id, cache_key)`, 24h TTL enforced in app code.
- `saved_queries` — Data Explorer/SOQL saved state.

All tables: `alter table ... enable row level security;` with **no policies** (server uses service-role key which bypasses RLS).

## Client-side persistence (localStorage keys)

`sfde.session`(cookie, not LS), `sfde.soql.text/limit`, `sfde.explorer.state`,
`sfde.objects.{filter,selected,cats,expanded,sub,sortMode}`, `sfde.bulk.*`,
`sfde.recentObjects`, `sfde.theme`.

## Key flows

- **Access token**: `getAccessToken(connectionId)` in `salesforce.ts` returns a **per-connection in-memory cached** token, minting via refresh_token/client_credentials only when the cache is empty or near expiry (honors `expires_in`, else `SF_TOKEN_TTL_SECONDS` default 15 min). `sfFetch`/`bulkFetch` re-mint once on a `401`; `disconnect` clears the entry. Cache is per warm serverless instance.
- **Export** (≤50k rows): CSV/JSON **stream** page by page via `streamSoql` + a `ReadableStream` (one Salesforce batch in memory at a time; columns fixed from the first batch). XLSX stays buffered (`runSoql` → full matrix → ZIP).
- **Bulk import**: CSV is sent as a JSON string in the POST body (bounded by Vercel's ~4.5MB body limit).

## Deploy / versioning workflow (also see AGENTS.md)

Branch `claude/salesforce-bulk-api-app-pic36h` is restarted from `main` for each
change → PR → squash-merge → Vercel auto-deploys. `package.json` version +
`CHANGELOG.md` bumped every change; the version renders as a badge in the header.

## Environment variables

`APP_BASE_URL`, `APP_PASSWORD`, `APP_SESSION_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`
(32 bytes base64), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Optional: `SF_TOKEN_TTL_SECONDS` (access-token cache fallback TTL, default 900).
Salesforce Connected App creds are stored **in-app** (DB), not env, since v0.3.0.
