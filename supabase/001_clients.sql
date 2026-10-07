-- Blaise Culinary Creations: clients table
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Access model: nobody reaches this table through the public Data API.
-- Only the Netlify Function, using the service-role (secret) key, can read or write it.

begin;

create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null
                 check (char_length(btrim(full_name)) between 1 and 120),
  phone          text
                 check (phone is null or phone ~ '^\+?[0-9]{10,15}$'),          -- stored as digits, e.g. +16317101226
  email          text
                 check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  address_line1  text check (address_line1 is null or char_length(address_line1) <= 200),
  address_line2  text check (address_line2 is null or char_length(address_line2) <= 200),
  city           text check (city is null or char_length(city) <= 100),
  state          text check (state is null or state ~ '^[A-Z]{2}$'),
  postal_code    text check (postal_code is null or postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  dietary_notes  text check (dietary_notes is null or char_length(dietary_notes) <= 4000),  -- allergies, restrictions, preferences
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.clients is 'Private client records. RLS on, no policies: only the service role (Netlify Function) can access.';

-- Keep updated_at current on every edit
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- Lookups used by the dashboard
create index if not exists clients_full_name_idx on public.clients (lower(full_name));
create index if not exists clients_phone_idx     on public.clients (phone);
create index if not exists clients_email_idx     on public.clients (lower(email));

-- ---------- Lock it down ----------
-- 1. Row Level Security on, and forced even for the table owner.
alter table public.clients enable row level security;
alter table public.clients force row level security;

-- 2. No policies are created on purpose. With RLS on and zero policies,
--    every request from the anon and authenticated roles returns nothing
--    and every write is rejected (deny by default).

-- 3. Remove table privileges from the public API roles as a second layer,
--    so even a policy added by mistake later cannot expose the data.
revoke all on table public.clients from anon, authenticated, public;

-- 4. The service_role keeps access (it bypasses RLS by design). It is used
--    only server-side inside the Netlify Function and never sent to a browser.
grant select, insert, update, delete on table public.clients to service_role;

commit;

-- Optional check, run after the script. Both should return 0 rows / false:
--   select * from pg_policies where tablename = 'clients';
--   select has_table_privilege('anon', 'public.clients', 'select');
