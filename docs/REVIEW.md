# Engineering Review

A candid, multi-perspective critique of Salesforce Data Explorer as of v0.19.0.
Severity: **[P0]** critical / **[P1]** high / **[P2]** medium / **[P3]** low.
Actionable items are consolidated and prioritized in [`../TODO.md`](../TODO.md).

---

## 1. Security analyst / white-hat pentester

The app is **publicly reachable on the internet** and, once unlocked, holds a
live Salesforce connection with the `api` scope (read/write to the org). The
whole security boundary is one shared password. Treat that boundary seriously.

- **[P0] No rate limiting / lockout on `POST /api/app-auth/login`.** A single
  shared `APP_PASSWORD` protects everything, and the endpoint accepts unlimited
  guesses. Constant-time compare (`session.ts`) prevents timing leaks but not
  brute force. Add per-IP throttling + exponential backoff/lockout (Vercel
  middleware + Upstash Redis, or Vercel WAF), and enforce a strong password.
- **[P1] No security headers / CSP.** `next.config.js` sets only
  `poweredByHeader:false`. There is no `Content-Security-Policy`,
  `X-Frame-Options`/`frame-ancestors` (clickjacking), `X-Content-Type-Options`,
  `Referrer-Policy`, or `Permissions-Policy`. Note the theme-init inline script
  in `layout.tsx` and inline event handlers/styles require a nonce or hash for a
  strict CSP. HSTS is provided by Vercel.
- **[P1] CSV / formula injection in exports.** `export/route.ts#csvCell` quotes
  but does not neutralize leading `= + - @` (or tab/CR). A Salesforce record
  whose value is `=cmd|'/c calc'!A1` becomes a live formula when the CSV is
  opened in Excel/Sheets. Prefix risky cells with `'` or wrap. (The XLSX writer
  uses `inlineStr`, so `.xlsx` is safe; **CSV is the exposure**.)
- **[P2] Session cannot be revoked and carries no identity/nonce.** The cookie
  is `HMAC(expiryMs)`; any valid unexpired cookie is accepted. There's no
  server-side session store, so "log out everywhere," rotation, or invalidation
  on secret change isn't possible without rotating `APP_SESSION_SECRET`.
- **[P2] Single symmetric key protects all secrets, stored as a plain env var.**
  `CREDENTIALS_ENCRYPTION_KEY` decrypts every refresh token and client secret.
  If Vercel env leaks (or a future SSRF/log leak), everything is decryptable.
  Consider Supabase Vault / a KMS and key rotation. Encryption itself
  (AES-256-GCM, random 96-bit IV per op) is done correctly.
- **[P2] Destructive Bulk operations lack a confirmation.** `bulk/ingest`
  accepts `delete` / `hardDelete`; the UI runs them straight from a button.
  Add an explicit "type the object name / row count" confirm for destructive ops.
- **[P3] Debug endpoint is an info-disclosure surface.** `/api/salesforce/debug`
  is app-auth gated and returns no secrets (only booleans + non-secret consumer
  keys), which is fine — but keep it gated and consider removing from production
  or flagging behind an env toggle.
- **[P3] Callback error text is reflected into a redirect query param.**
  `auth/salesforce/callback` puts Salesforce `error_description` into
  `/connections?error=...`. It's rendered as React text (escaped), so not XSS,
  but avoid echoing upstream errors verbatim.

**Good:** RLS enabled + deny-all policies (defense in depth), service-role key
server-only, refresh tokens/secrets encrypted at rest, object name sanitized in
`objects/[name]` (path-traversal safe), SOQL runs with the connected user's
permissions so Salesforce enforces FLS/sharing, OAuth `state` + cookie CSRF check.

---

## 2. Software engineer

- **[P1] No tests and no CI.** Zero automated tests; PRs merge without a build/
  lint/typecheck gate. High-value, low-effort units: `crypto` round-trip,
  `session` sign/verify + `checkPassword`, the SOQL builder's value quoting
  (`DataExplorer`), and `xlsx` validity (assert `unzip -t`). Add a GitHub Action
  running `npm run build`, `lint`, `typecheck`, tests on PRs.
- **[P1] Access token minted on every Salesforce call.** `getAccessToken` runs a
  `refresh_token`/`client_credentials` grant for *each* `sfFetch`
  (`salesforce.ts`). A single object explore or query fans out into many token
  requests — extra latency and real risk of hitting Salesforce OAuth rate limits.
  Cache the access token (in memory keyed by connection, or encrypted in
  Supabase) until near expiry.
- **[P2] Large exports buffer entirely in serverless memory.** `export/route.ts`
  and `bulk/query/.../results` accumulate up to 50k rows / many pages as strings
  before responding. On Vercel's default memory this can OOM for wide/large
  datasets. Stream responses (`ReadableStream`) or push big jobs through Bulk 2.0
  with a streamed download.
- **[P2] Bulk import CSV rides in a JSON body.** `bulk/ingest` reads
  `body.csv` (string) — doubles memory and is capped by Vercel's ~4.5MB request
  limit, so large imports fail. Prefer streaming/multipart or client→Salesforce
  direct upload.
- **[P2] No env-var validation at boot.** Missing `CREDENTIALS_ENCRYPTION_KEY`
  etc. fails deep in a request. Add a small `assertEnv()` used at startup / in a
  health route.
- **[P3] Auth check duplicated in ~20 routes.** Consider Next middleware to gate
  `/api/salesforce/*` and pages centrally.
- **[P3] `setActiveConnection` and `saveConnection` are multi-statement, not
  transactional.** Fine for single-user; note for multi-user.
- **[P3] `usePersistentState` writes on every keystroke.** Minor; debounce for
  large builder state.
- **[P3] API version pinned to `v61.0`.** Add a periodic-bump reminder.

**Good:** clean module boundaries, shared UI extracted (`fieldUi`), consistent
error surfacing, dependency-light (no charting/UI libs), the hand-rolled XLSX
writer is correct (verified via `unzip -t`), metadata caching reduces API load.

---

## 3. UX designer

- **[P2] Result grids render every row to the DOM** (up to 2,000). Wide result
  sets get sluggish; add virtualization (e.g. windowing) or paging.
- **[P2] Some errors surface raw Salesforce JSON.** Map common errors
  (`INVALID_FIELD`, auth expiry) to friendly messages with a "copy details" affordance.
- **[P2] Accessibility gaps.** Modals lack focus trapping/return; the SOQL
  overlay editor and SVG schema map need keyboard paths; some icon-only buttons
  need `aria-label` (several already have them). Run axe.
- **[P3] Top bar is crowded** on small screens (6 links + switcher + menu).
  Consider collapsing page links into the menu on mobile.
- **[P3] No toasts / confirmation feedback** for background successes (activate
  connection reloads; saves are silent). Light, non-blocking confirmations help.

**Good:** consistent dark/light theming with no-flash init, global progress bar +
per-button states, persistent working state across logout, funnel filters, the
schema map, recents, and the object directory are genuinely nice touches.

---

## 4. Legal / privacy / compliance

- **[P1] No LICENSE and no privacy/terms.** Add a LICENSE (or keep explicitly
  private) and, if it ever leaves personal use, a short privacy notice.
- **[P2] Data handling posture should be documented.** Customer *records* are
  never persisted server-side (only shown in-browser / exported by the user);
  Supabase stores org *schema* (describes), *encrypted* tokens/secrets, and saved
  queries. If used against production orgs with PII, note GDPR/CCPA implications:
  data minimization, purpose limitation, and that "Disconnect" deletes stored
  tokens (right-to-erasure of credentials). No third-party analytics/PII egress
  today — keep it that way or disclose.
- **[P3] Salesforce API/Connected App terms.** The app acts as the authenticated
  user; ensure usage complies with the org's API and security policies.

---

## 5. Marketer / founder / executive

- **Positioning:** a hosted, prettier **Workbench / Salesforce Inspector**. The
  schema map, multi-connection switching, saved queries, and modern UX are
  differentiators vs. Workbench (dated) and Inspector Reloaded (browser extension).
- **[P1] To become multi-tenant SaaS** you need real auth (Supabase Auth /
  SSO), per-user RLS + org isolation, billing, and audit logs. The current
  single-password model is the main blocker.
- **Moat / roadmap ideas:** saved-query sharing, org-to-org schema/data compare,
  scheduled exports, metadata deploy, and Bulk job monitoring. Observability
  (Sentry) and a status page raise trust for paying users.
- **Risk:** you're one leaked password away from someone driving a customer's
  Salesforce org. Fixing the P0/P1 security items is a prerequisite to any
  external users.

---

## Suggested services / better options

- **Auth:** Supabase Auth (magic link / OAuth + MFA) → revocable sessions, multi-user, per-user RLS. Replaces `APP_PASSWORD`.
- **Key management:** Supabase Vault or cloud KMS for `CREDENTIALS_ENCRYPTION_KEY`; enable rotation.
- **Rate limiting:** Upstash Redis + Vercel middleware, or Vercel WAF/Firewall.
- **Token caching:** in-memory LRU per connection, or encrypted `access_token` + `expires_at` in Supabase.
- **Large data:** stream exports; lean on Bulk API 2.0 for big jobs.
- **Testing/CI:** Vitest (unit) + Playwright (e2e) + GitHub Actions.
- **Observability:** Sentry (errors), Vercel Analytics/Speed Insights.
- **Headers:** `next.config.js` `headers()` with CSP (nonce for the theme script), `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`.
