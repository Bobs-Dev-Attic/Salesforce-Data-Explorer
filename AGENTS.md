# Agent Guide

Orientation for coding agents (Codex, Claude Code, etc.) working in this repo.
**Read this and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before scanning the
tree** — they exist to save you a re-derivation pass. Don't grep the whole
codebase to rebuild the map; it's already here.

## What this is

A single-user Next.js 14 (App Router) app on Vercel that connects to Salesforce
(OAuth or Client Credentials), runs SOQL, explores/exports object data, and
imports via the Bulk API. Supabase Postgres stores encrypted credentials, a
schema cache, and saved queries. ~6,900 LOC, no UI framework — hand-rolled CSS.

## Fast orientation (don't re-scan)

- **The map** is `docs/ARCHITECTURE.md`: stack, trust model, directory map, data
  model, localStorage keys, key flows, env vars.
- **Known issues / backlog** is `TODO.md` (prioritized P0–P3). Before "finding
  bugs," check whether it's already listed.
- **Security posture** is `SECURITY.md`. **Full critique** is `docs/REVIEW.md`.
- **Where logic lives:** almost everything server-side is in `src/lib/`
  (`salesforce.ts`, `crypto.ts`, `session.ts`, `bulk.ts`, `savedQueries.ts`,
  `xlsx.ts`). Route handlers in `src/app/api/**` are thin wrappers that
  auth-check then call `src/lib`. UI is in `src/components/`.

## Conventions (match these, don't reinvent)

- All route handlers set `export const runtime = "nodejs"` and call
  `isAuthenticated()` first. New API routes must do both.
- Secrets (refresh tokens, client secrets) go through `crypto.ts`
  encrypt/decrypt before touching Supabase. Never return them to the client,
  never log them.
- Supabase is reached only via the server-only service-role client
  (`src/lib/supabase.ts`). Never import it into a client component.
- Client persistence uses `usePersistentState` (localStorage). Keys are
  namespaced `sfde.*` — see ARCHITECTURE for the list.
- No new runtime dependencies unless necessary — the app is deliberately
  dependency-light (only `next`, `react`, `@supabase/supabase-js`).
- Salesforce REST is pinned at `v61.0`. Match existing patterns in
  `salesforce.ts` for new calls (`sfFetch`).

## Database changes

Add a numbered migration in `supabase/migrations/` (next is `0004_*`). Tables
enable RLS with **no policies** (server bypasses via service-role key). Apply via
the Supabase MCP `apply_migration` against project `wdrewwsxbtovikgudenj`. Keep
`ARCHITECTURE.md`'s data-model section in sync.

## Ship workflow — follow exactly

The branch `claude/salesforce-bulk-api-app-pic36h` is **restarted from `main`
for each change**, then PR → squash-merge → Vercel auto-deploys.

1. `git fetch origin main && git checkout -B claude/salesforce-bulk-api-app-pic36h origin/main`
2. Make the change.
3. **Bump `package.json` `version`** (semver: patch/minor) — it renders as a
   badge in the header, so users watch it.
4. **Add a `CHANGELOG.md` entry** for the new version (keep the existing format).
5. Commit with a clear message. `git push -u origin <branch> --force-with-lease`
   (the branch is force-updated each cycle; retry on transient network errors
   with backoff).
6. Open a PR, squash-merge it.

### Gotchas (learned the hard way)

- **Do not push git tags** — the proxy drops the sideband and tag pushes fail.
  Versioning lives in `package.json` + `CHANGELOG.md`, not tags.
- **Never push to `main`.** Only the designated branch.
- **`--force-with-lease` is required** because the branch is reset to `main`
  each cycle (non-fast-forward otherwise).
- If the branch's prior PR was already merged, treat new work as fresh: restart
  from `main` (step 1) — don't stack on merged history.
- Do not put model IDs or internal identifiers in commits/PRs/code — chat only.

## Infra IDs (so you don't re-derive them)

- **Supabase project:** `wdrewwsxbtovikgudenj` (use Supabase MCP).
- **Vercel:** GitHub auto-deploy on merge to `main`; app at
  `salesforce-data-explorer.vercel.app` (use Vercel MCP).
- **GitHub repo:** `bobs-dev-attic/salesforce-data-explorer` (use github MCP).
- **Env vars:** listed in `SECURITY.md` and `ARCHITECTURE.md`.

## Before you finish

CI (`.github/workflows/ci.yml`) gates PRs + pushes to `main` on typecheck →
lint → test → build. Run the same locally: `npm run typecheck && npm run lint &&
npm test && npm run build`. Tests are Vitest, colocated as `src/**/*.test.ts`;
add or extend them when you touch security- or correctness-critical logic
(`crypto`, `session`, `rateLimit`, `csv`, SOQL building). Keep the docs above
accurate if you change architecture, env vars, or the data model.
