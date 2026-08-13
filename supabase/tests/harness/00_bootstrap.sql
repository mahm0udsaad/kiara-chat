-- Supabase-equivalent bootstrap for an isolated verification database.
--
-- A managed Supabase project supplies these roles, schemas and helpers before
-- any migration runs. Recreating them locally is what lets the real migration
-- files be applied verbatim, from zero, without a Docker stack and without
-- touching a hosted project.
--
-- This file is deliberately NOT a migration. It never runs against Supabase.

create extension if not exists pgcrypto;

-- Roles. `service_role` and `authenticator` bypass RLS in a real project;
-- `anon` and `authenticated` never do. Reproducing that distinction is the
-- whole point of the privilege tests.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin noinherit bypassrls;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants the API roles everything on new objects in `public` by
-- default. Reproducing that is what makes the privilege tests real: without
-- it, a migration that forgot to REVOKE would still look locked down here.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;

create schema if not exists auth;
create schema if not exists realtime;
create schema if not exists extensions;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema realtime to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  created_at timestamptz not null default now()
);

-- Request-scoped claims. Supabase populates these from the verified JWT; the
-- tests set them directly with `set local`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

-- Realtime. Only the shape the inbox policy depends on: the `messages` table
-- it is attached to and the `topic()` helper it compares against.
create table if not exists realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null,
  payload jsonb,
  inserted_at timestamptz not null default now()
);

create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;

-- July 2026: the managed `realtime` schema is locked, but RLS is already on
-- for `realtime.messages` upstream. Mirroring that here is what makes the
-- migration's policy-only approach testable.
alter table realtime.messages enable row level security;
grant select on realtime.messages to authenticated;

-- Test assertion helper. Every check raises rather than returning a row, so
-- `psql -v ON_ERROR_STOP=1` turns any failed expectation into a failed run.
create schema if not exists kiara_test;
-- Assertions also run from sessions that have dropped to `anon`/`authenticated`,
-- so the helpers themselves must stay reachable from those roles.
grant usage on schema kiara_test to public;

create or replace function kiara_test.ok(p_condition boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'ASSERTION FAILED: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

-- Asserts that `p_sql` fails, and that it fails with the expected message.
-- A command that succeeds when it should have been rejected is the single
-- most dangerous outcome in this suite, so it is never silently tolerated.
create or replace function kiara_test.raises(p_sql text, p_expected text, p_label text)
returns void
language plpgsql
as $$
declare
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    v_message := sqlerrm;
  end;

  if v_message is null then
    raise exception 'ASSERTION FAILED: % (expected error %, but the statement succeeded)',
      p_label, p_expected;
  end if;
  if position(p_expected in v_message) = 0 then
    raise exception 'ASSERTION FAILED: % (expected error %, got %)',
      p_label, p_expected, v_message;
  end if;
  raise notice '  ok  % [%]', p_label, p_expected;
end;
$$;
