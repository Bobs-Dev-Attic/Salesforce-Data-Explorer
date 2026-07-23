# Security Policy & Threat Model

Salesforce Data Explorer is a **single-user** app that, once unlocked, holds a
live Salesforce connection with `api` scope (read/write to the connected org).
This document states the current posture honestly. Known gaps are tracked in
[`TODO.md`](TODO.md); the full critique is in [`docs/REVIEW.md`](docs/REVIEW.md).

## Reporting

This is a personal project. To report a vulnerability, open a private security
advisory on the GitHub repo or email the maintainer. Please do not file public
issues for exploitable findings.

## Trust model

```
Browser ──APP_PASSWORD──▶ HMAC-signed httpOnly cookie ──▶ Next route handlers
  handlers ──service-role key──▶ Supabase (encrypted tokens, schema cache, saved queries)
  handlers ──per-connection access token──▶ Salesforce REST / Bulk API
```

- **One security boundary:** the shared `APP_PASSWORD`. Anyone who has it can
  drive the connected Salesforce org. Keep it strong and secret.
- **No per-user identity.** There are no accounts, roles, or per-user data
  isolation. Do not treat this as multi-tenant.

## What protects what

| Asset | Protection |
| --- | --- |
| App access | `APP_PASSWORD` → HMAC-signed cookie (`APP_SESSION_SECRET`), 7-day expiry, `httpOnly` + `secure` (prod) + `SameSite=lax` |
| Salesforce refresh tokens | AES-256-GCM at rest (`CREDENTIALS_ENCRYPTION_KEY`), random 96-bit IV per op |
| Connected App client secrets | AES-256-GCM at rest, same key |
| Supabase tables | RLS enabled, **no policies** → anon/publishable key sees nothing; server uses service-role key only |
| Salesforce data access | Runs as the connected user — Salesforce enforces FLS/sharing/object perms |
| OAuth callback | `state` param + cookie CSRF check |
| Path traversal | Object name sanitized in `objects/[name]` |

## Handled correctly (do not regress)

- Service-role key is **server-only** — never shipped to the client.
- Refresh tokens and client secrets are **never** returned to the browser or logged.
- Constant-time password compare (`session.ts`).
- `/api/salesforce/debug` is app-auth gated and returns only booleans +
  non-secret consumer keys.
- The XLSX writer emits `inlineStr` cells → not a formula-injection vector.

## Known gaps (see TODO.md for the fix list)

- **P0** No rate limiting / lockout on the login endpoint (brute-force surface).
- **P1** No CSP / security headers (`next.config.js` sets only `poweredByHeader:false`).
- **P1** CSV export does not neutralize formula-trigger characters (`= + - @`).
- **P2** Sessions can't be revoked (cookie is `HMAC(expiryMs)`, no server store).
- **P2** One symmetric key decrypts all secrets, stored as a plain env var.
- **P2** Destructive Bulk `delete`/`hardDelete` has no typed confirmation.

## Data handling

- **Customer records are never persisted server-side.** They are shown in the
  browser and exported by the user on demand only.
- **Supabase stores:** encrypted refresh tokens + client secrets, org *schema*
  (describe/global cache, 24h TTL), and saved queries. No record-level PII.
- **No third-party analytics or PII egress** today. If that changes, disclose it.
- **"Disconnect"** deletes the stored (encrypted) tokens for that connection —
  the credential right-to-erasure path.

## Secrets / environment

Required env vars (never commit these): `APP_PASSWORD`, `APP_SESSION_SECRET`,
`CREDENTIALS_ENCRYPTION_KEY` (32 bytes base64), `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `APP_BASE_URL`. Salesforce Connected App creds are
stored in-app (encrypted in Supabase), not in env. Rotating `APP_SESSION_SECRET`
invalidates all existing sessions; rotating `CREDENTIALS_ENCRYPTION_KEY` requires
re-encrypting stored secrets.
