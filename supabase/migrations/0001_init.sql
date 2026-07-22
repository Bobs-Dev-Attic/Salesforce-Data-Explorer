-- Salesforce Data Explorer — initial schema
-- Single-user app. Access is gated at the application layer (APP_PASSWORD)
-- and the DB is reached only via the service role key from server code.
-- RLS is enabled with no permissive policies so the anon/public key can
-- never read these tables directly.

-- ------------------------------------------------------------------
-- Salesforce connections: one row per connected org.
-- The refresh token is stored ENCRYPTED (AES-256-GCM) by the app before
-- it ever reaches the database.
-- ------------------------------------------------------------------
create table if not exists public.salesforce_connections (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   text,                       -- Salesforce org id (from identity URL)
  username                 text,                       -- Salesforce username (display only)
  instance_url             text not null,              -- e.g. https://mycompany.my.salesforce.com
  -- Encrypted refresh token, stored as "iv:authTag:ciphertext" (all base64).
  refresh_token_encrypted  text not null,
  label                    text,                       -- user-friendly name for the connection
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index if not exists salesforce_connections_org_uniq
  on public.salesforce_connections (org_id)
  where org_id is not null;

-- ------------------------------------------------------------------
-- Metadata cache: cached describe/global results per connection.
-- cache_key examples: 'describeGlobal', 'describe:Account'
-- ------------------------------------------------------------------
create table if not exists public.sf_metadata_cache (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references public.salesforce_connections(id) on delete cascade,
  cache_key      text not null,
  payload        jsonb not null,
  fetched_at     timestamptz not null default now(),
  unique (connection_id, cache_key)
);

create index if not exists sf_metadata_cache_conn_idx
  on public.sf_metadata_cache (connection_id);

-- ------------------------------------------------------------------
-- keep updated_at fresh
-- ------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sf_conn_updated on public.salesforce_connections;
create trigger trg_sf_conn_updated
  before update on public.salesforce_connections
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- Lock everything down. Server uses the service role key which bypasses RLS.
-- With RLS on and no policies, the anon/public key gets zero rows.
-- ------------------------------------------------------------------
alter table public.salesforce_connections enable row level security;
alter table public.sf_metadata_cache      enable row level security;
