-- Salesforce Data Explorer — saved queries
--
-- Stores Data Explorer builder configurations (object, columns, filters,
-- relationship/child fields, order, limit) plus the generated SOQL, so a user
-- can save and reload queries. Org-agnostic (not tied to a connection).

create table if not exists public.saved_queries (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  object_name    text,
  soql           text not null,
  builder_state  jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists saved_queries_name_uniq
  on public.saved_queries (name);

drop trigger if exists trg_saved_queries_updated on public.saved_queries;
create trigger trg_saved_queries_updated
  before update on public.saved_queries
  for each row execute function public.set_updated_at();

alter table public.saved_queries enable row level security;
