# TODO — Prioritized Backlog

Consolidated, prioritized action list distilled from [`docs/REVIEW.md`](docs/REVIEW.md).
Ordered by risk-adjusted priority. Check items off as they ship; keep the
version/CHANGELOG discipline described in [`AGENTS.md`](AGENTS.md).

Severity key: **P0** ship-blocker · **P1** high · **P2** medium · **P3** nice-to-have.

---

## P0 — Do before any additional exposure

- [ ] **Rate-limit `POST /api/app-auth/login`.** One shared password + unlimited
  guesses = brute-force surface. Add per-IP throttle + lockout/backoff
  (Vercel middleware + Upstash Redis, or Vercel WAF). Enforce a strong
  `APP_PASSWORD` (length/entropy check at boot). _(REVIEW §1)_

## P1 — High priority

- [ ] **Security headers / CSP.** Add `headers()` in `next.config.js`:
  `Content-Security-Policy` (nonce for the `layout.tsx` theme-init inline
  script), `X-Frame-Options: DENY` / `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- [ ] **CSV / formula injection in exports.** `export/route.ts#csvCell` must
  neutralize leading `= + - @` (and tab/CR) — prefix with `'` or wrap. XLSX
  path is already safe (`inlineStr`).
- [ ] **Cache the Salesforce access token.** `getAccessToken` currently mints a
  fresh token on every `sfFetch`. Cache per connection until near expiry
  (in-memory LRU, or encrypted `access_token`+`expires_at` in Supabase).
  Cuts latency and OAuth rate-limit risk.
- [ ] **Add tests + CI.** Vitest units for `crypto` round-trip, `session`
  sign/verify + `checkPassword`, SOQL value quoting, `xlsx` validity. GitHub
  Action gating PRs on `build` + `lint` + `typecheck` + tests.
- [ ] **Add a LICENSE** (or mark explicitly private). Add a short privacy note
  if it ever leaves personal use.

## P2 — Medium priority

- [ ] **Session revocation / identity.** Cookie is `HMAC(expiryMs)` only — no
  revoke, no "log out everywhere." Add a server-side session store or a
  rotating nonce, or migrate to Supabase Auth.
- [ ] **Key management.** Move `CREDENTIALS_ENCRYPTION_KEY` to Supabase Vault /
  a KMS; enable rotation. (Encryption itself is correct.)
- [ ] **Confirm destructive Bulk ops.** `bulk/ingest` `delete`/`hardDelete` runs
  from a button — require typing the object name / row count first.
- [ ] **Stream large exports.** `export` and bulk results buffer up to 50k rows
  in serverless memory (OOM risk). Use `ReadableStream` / Bulk 2.0 download.
- [ ] **Bulk import CSV off the JSON body.** `bulk/ingest` reads `body.csv`
  (capped ~4.5MB by Vercel). Use streaming/multipart or direct-to-Salesforce.
- [ ] **`assertEnv()` at boot / health route.** Fail fast on missing
  `CREDENTIALS_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, etc.
- [ ] **Virtualize result grids.** Up to 2,000 rows hit the DOM; window or page.
- [ ] **Friendly error mapping.** Map `INVALID_FIELD`, auth-expiry, etc. to
  readable messages with a "copy details" affordance.
- [ ] **Accessibility pass.** Focus trap/return in modals, keyboard paths for the
  SOQL overlay editor + SVG schema map, `aria-label` audit. Run axe.
- [ ] **Document data-handling posture** (GDPR/CCPA): records never persisted
  server-side; only encrypted tokens + schema cache + saved queries are stored.

## P3 — Nice-to-have

- [ ] Central auth middleware for `/api/salesforce/*` (dedupe ~20 checks).
- [ ] Debounce `usePersistentState` writes for large builder state.
- [ ] Remove/flag `/api/salesforce/debug` in production.
- [ ] Stop echoing upstream Salesforce `error_description` verbatim in redirects.
- [ ] Toasts / non-blocking success confirmations.
- [ ] Collapse top-bar page links into the menu on mobile.
- [ ] Periodic Salesforce API-version bump reminder (pinned at `v61.0`).
- [ ] Observability: Sentry + Vercel Analytics.

---

## Path to multi-tenant SaaS (if pursued)

Real auth (Supabase Auth / SSO + MFA), per-user RLS + org isolation, billing,
audit logs. The single-password model is the blocker. See REVIEW §5.
