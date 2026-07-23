# Salesforce Data Explorer

A web-friendly app (Next.js + Supabase, hosted on Vercel) to securely connect to
your Salesforce org, run SOQL queries, explore object metadata, export data, and
bulk-import/export via the Salesforce Bulk API 2.0.

- 🔐 **Secure by design** — Salesforce OAuth 2.0 web flow. We store only an
  **encrypted** (AES-256-GCM) refresh token; you log in on Salesforce's own page.
- 🗂️ **Metadata caching** — global + per-object describes cached in Supabase.
- 🔎 **SOQL runner** — run queries, browse results, export to CSV.
- 🧭 **Object explorer** — browse every SObject and its fields.
- 📦 **Bulk API 2.0** — export large datasets and import/upsert records from CSV.
- 👤 **Single-user** — the whole app is gated behind one password.

## Architecture

| Layer      | Tech                                   |
| ---------- | -------------------------------------- |
| Frontend   | Next.js 14 (App Router), React, TS     |
| Backend    | Next.js Route Handlers (Node runtime)  |
| Database   | Supabase (Postgres)                    |
| Hosting    | Vercel                                 |
| Salesforce | REST API v61.0 + OAuth 2.0 + Bulk API 2.0 |

Secrets never reach the browser: the Supabase service-role key, Salesforce client
secret, and encryption key are all server-side only.

## Setup

### 1. Salesforce Connected App

In Salesforce Setup → **App Manager → New Connected App**:

- Enable OAuth Settings.
- **Callback URL:** `https://<your-vercel-domain>/api/auth/salesforce/callback`
  (and `http://localhost:3000/api/auth/salesforce/callback` for local dev).
- **OAuth Scopes:** `Manage user data via APIs (api)`, `Perform requests at any
  time (refresh_token, offline_access)`.
- Save, then copy the **Consumer Key** and **Consumer Secret**.

> As of **v0.3.0**, you don't put these in env vars. Open the app's
> **Connections** page, click **Add Connected App**, and paste the login URL,
> Consumer Key, and Consumer Secret there — they're encrypted at rest. You can
> register multiple apps/orgs and switch the active connection.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the values. Generate the
encryption key and secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # CREDENTIALS_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"       # APP_SESSION_SECRET / APP_PASSWORD
```

### 3. Database

Apply the migration in `supabase/migrations/0001_init.sql` to your Supabase
project (via the Supabase SQL editor or CLI).

### 4. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000, unlock with `APP_PASSWORD`, then **Connect to
Salesforce**.

## Deploy (Vercel)

Set all env vars from `.env.example` in the Vercel project settings, set
`APP_BASE_URL` to your production URL, and add that URL's callback to the
Connected App. Push to the default branch to deploy.

## Versioning

Semantic Versioning. Every change bumps `package.json` and is recorded in
[`CHANGELOG.md`](./CHANGELOG.md); releases are tagged in git.

## License

[MIT](./LICENSE).
