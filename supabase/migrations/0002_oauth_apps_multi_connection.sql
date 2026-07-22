-- Salesforce Data Explorer — OAuth app credentials + multi-connection support
--
-- Moves the Salesforce Connected App credentials (login URL, consumer key,
-- consumer secret) out of environment variables and into the database so the
-- user can register them in-app. The client secret is AES-256-GCM encrypted by
-- the application before storage. Multiple connections (orgs) can be saved and
-- switched between.

-- ------------------------------------------------------------------
-- Connected App credentials, entered by the user in-app.
-- ------------------------------------------------------------------
create table if not exists public.salesforce_oauth_apps (
  id                      uuid primary key default gen_random_uuid(),
  label                   text not null,
  login_url               text not null default 'https://login.salesforce.com',
  client_id               text not null,
  client_secret_encrypted text not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.salesforce_oauth_apps enable row level security;

drop trigger if exists trg_sf_app_updated on public.salesforce_oauth_apps;
create trigger trg_sf_app_updated
  before update on public.salesforce_oauth_apps
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- Link each connection to the app it was authorized with, so token
-- refresh can use the right client credentials.
-- ------------------------------------------------------------------
alter table public.salesforce_connections
  add column if not exists oauth_app_id uuid
    references public.salesforce_oauth_apps(id) on delete set null;

create index if not exists salesforce_connections_app_idx
  on public.salesforce_connections (oauth_app_id);

-- is_active already exists (from 0001); ensure only-one-active is handled in
-- application code when selecting the active connection.
