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
| App access | `APP_PASSWORD` → HMAC-signed cookie (`APP_SESSION_SECRET`), 7-day expiry, `httpOnly` + `secure` (prod) + `SameSite=lax`, revocable via session epoch |
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

## Fixed in v0.20.0

- Login rate limiting / lockout (`src/lib/rateLimit.ts`) — 5 fails / 15-min
  window → 15-min lockout. (In-memory baseline; durable limiter still on the
  backlog.)
- Nonce-based CSP + security headers (`src/middleware.ts`, `next.config.js`).
- CSV formula-injection hardening (`export/route.ts#csvCell`).

## Key rotation (v0.26.0+)

Secrets are encrypted with a **keyring**: the active key encrypts new data; any
key in the ring can decrypt. Ciphertext is `keyId:iv:authTag:ciphertext` (legacy
3-segment values decrypt as key `v1`). To rotate:

1. Generate a new 32-byte key:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Add it to the ring and make it active (Vercel env), then redeploy:
   - `CREDENTIALS_ENCRYPTION_KEYS=v2:<base64>` (keep the old key in the ring)
   - `CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID=v2`
3. **Re-encrypt** existing rows: App menu → **Re-encrypt secrets**
   (`POST /api/admin/rekey`, app-auth gated, idempotent).
4. Once every row is migrated, retire the old key by removing it from the ring.

Rotate after any suspected exposure of a key, or on a periodic schedule.

## Known gaps (see TODO.md for the fix list)

- **P1 (follow-up)** Login limiter is in-memory/per-instance — move to Redis/WAF
  for a durable cross-instance limit; add an `APP_PASSWORD` strength check.
- **P2 (follow-up)** Session revocation is **global** ("sign out all"), not
  per-session; and revocation propagates to other warm instances within the
  30 s epoch-cache TTL. Per-device/per-user session management needs Supabase Auth.
- **P2 (follow-up)** Keys still live in plain Vercel env — move them into Supabase
  Vault / a cloud KMS. (Rotation is now supported; see above.)

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
stored in-app (encrypted in Supabase), not in env. Optional key-rotation vars:
`CREDENTIALS_ENCRYPTION_KEYS`, `CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID` (see
**Key rotation** above). Rotating `APP_SESSION_SECRET` invalidates all existing
sessions; the encryption key is rotated via the keyring + re-encrypt flow.
