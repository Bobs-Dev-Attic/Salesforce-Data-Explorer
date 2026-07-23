-- Key/value store for server-side app settings. Currently holds the session
-- epoch used for session revocation ("sign out everywhere"): bumping the epoch
-- invalidates every previously-issued session cookie.
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
-- No policies: only the server-side service-role client (which bypasses RLS)
-- may read/write. The anon/publishable key sees nothing.

-- Seed the session epoch.
insert into public.app_settings (key, value)
values ('session_epoch', '1')
on conflict (key) do nothing;
