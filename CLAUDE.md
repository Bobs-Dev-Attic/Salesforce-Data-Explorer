# CLAUDE.md

Guidance for Claude Code in this repo. The full agent guide is
[`AGENTS.md`](AGENTS.md) and the map is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — **read those first** instead of
re-scanning the tree. This file is the quick-reference so you spend tokens on the
task, not on rediscovery.

## TL;DR

Single-user Next.js 14 (App Router) + Supabase + Salesforce app on Vercel.
Server logic lives in `src/lib/`; API routes in `src/app/api/**` are thin
auth-checked wrappers; UI in `src/components/`. ~6,900 LOC, dependency-light.

## Don't re-derive these

- **Map / data model / env vars:** `docs/ARCHITECTURE.md`.
- **Backlog & known bugs (P0–P3):** `TODO.md` — check before "finding" issues.
- **Security posture / threat model:** `SECURITY.md`; full critique `docs/REVIEW.md`.
- **Supabase project:** `wdrewwsxbtovikgudenj` · **repo:**
  `bobs-dev-attic/salesforce-data-explorer` · **app:**
  `salesforce-data-explorer.vercel.app`.

## Hard rules

- New API route → `export const runtime = "nodejs"` **and** `isAuthenticated()` first.
- Secrets always through `crypto.ts`; never returned to client, never logged.
- Supabase only via the server-only service-role client — never in a client component.
- No new runtime deps without a strong reason.
- Never push to `main`. Never push git tags (proxy drops them).
- Keep model IDs / internal identifiers out of commits, PRs, and code.

## Every change ships this way

1. `git fetch origin main && git checkout -B claude/salesforce-bulk-api-app-pic36h origin/main`
2. Make the change.
3. Bump `package.json` `version` (badge in header) + add a `CHANGELOG.md` entry.
4. Commit → `git push -u origin <branch> --force-with-lease` (retry transient
   network errors with 2/4/8/16s backoff).
5. Open PR → squash-merge → Vercel auto-deploys.

`--force-with-lease` is required because the branch is reset to `main` each
cycle. If the prior PR already merged, restart from `main` — don't stack on it.

## Verify before finishing

CI (`.github/workflows/ci.yml`) runs typecheck → lint → test → build on PRs.
Run the same locally before pushing: `npm run typecheck && npm run lint && npm
test && npm run build`. Add/extend Vitest tests (`src/**/*.test.ts`) when you
touch security- or correctness-critical logic. Update `docs/ARCHITECTURE.md` if
you change architecture, env vars, or the schema.
