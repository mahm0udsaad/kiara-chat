-- Kiara mobile: reuse the shared user_push_tokens table while separating Expo
-- projects/apps. Existing rows belong to the original Nehgz manager app; Kiara
-- registrations must write app_id='kiara-operations'.

alter table public.user_push_tokens
  add column if not exists app_id text not null default 'nehgz-manager',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists disabled_reason text,
  add column if not exists last_error_at timestamptz;

comment on column public.user_push_tokens.app_id is
  'Expo application/project namespace. Kiara mobile uses kiara-operations.';
comment on column public.user_push_tokens.device_id is
  'Random installation id persisted by the app, not a hardware identifier.';
comment on column public.user_push_tokens.disabled_reason is
  'Why delivery was disabled, for example logout or DeviceNotRegistered.';

-- Add the validation constraint only when an equivalent named constraint has
-- not already been installed. Avoid assuming the surrounding shared schema is
-- at one exact migration revision.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_push_tokens'::regclass
      and conname = 'user_push_tokens_app_id_check'
  ) then
    alter table public.user_push_tokens
      add constraint user_push_tokens_app_id_check
      check (char_length(btrim(app_id)) between 1 and 80);
  end if;
end
$$;

-- Replace only a unique key whose indexed key columns are exactly
-- (team_member_id, device_id), regardless of its name and regardless of whether
-- it was created as a standalone index or a UNIQUE constraint. Other unique
-- rules, especially the active expo_token rule, are untouched.
do $$
declare
  existing_key record;
  backing_constraint_name text;
begin
  if exists (
    select 1
    from public.user_push_tokens
    where device_id is not null
    group by team_member_id, app_id, device_id
    having count(*) > 1
  ) then
    raise exception using
      message = 'duplicate user_push_tokens rows block app-scoped uniqueness',
      hint = 'Run the verification query at the end of this migration and reconcile duplicates before retrying.';
  end if;

  for existing_key in
    select
      i.indexrelid,
      ni.nspname as index_schema,
      ci.relname as index_name
    from pg_index i
    join pg_class ct on ct.oid = i.indrelid
    join pg_namespace nt on nt.oid = ct.relnamespace
    join pg_class ci on ci.oid = i.indexrelid
    join pg_namespace ni on ni.oid = ci.relnamespace
    where nt.nspname = 'public'
      and ct.relname = 'user_push_tokens'
      and i.indisunique
      and i.indnkeyatts = 2
      and (
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(i.indkey) with ordinality as k(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = i.indrelid
         and a.attnum = k.attnum
        where k.ordinality <= i.indnkeyatts
      ) = array['team_member_id', 'device_id']::text[]
  loop
    select c.conname
      into backing_constraint_name
      from pg_constraint c
     where c.conindid = existing_key.indexrelid
       and c.contype = 'u'
     limit 1;

    if backing_constraint_name is not null then
      execute format(
        'alter table public.user_push_tokens drop constraint %I',
        backing_constraint_name
      );
    else
      execute format(
        'drop index %I.%I',
        existing_key.index_schema,
        existing_key.index_name
      );
    end if;

    backing_constraint_name := null;
  end loop;
end
$$;

create unique index if not exists user_push_tokens_member_app_device_key
  on public.user_push_tokens (team_member_id, app_id, device_id)
  where device_id is not null;

create index if not exists user_push_tokens_restaurant_app_active_idx
  on public.user_push_tokens (restaurant_id, app_id)
  where disabled = false;

-- Keep updated_at meaningful even when invalid-token cleanup is performed by a
-- service-role worker rather than the client registration endpoint.
create schema if not exists kiara_private;
revoke all on schema kiara_private from public, anon, authenticated;

create or replace function kiara_private.tg_touch_user_push_token_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function kiara_private.tg_touch_user_push_token_updated_at()
  from public, anon, authenticated;

drop trigger if exists touch_user_push_token_updated_at
  on public.user_push_tokens;

create trigger touch_user_push_token_updated_at
  before update on public.user_push_tokens
  for each row
  execute function kiara_private.tg_touch_user_push_token_updated_at();

alter table public.user_push_tokens enable row level security;

-- The policy name is defined by the shared project's applied migration. Tighten
-- both row visibility and the proposed new row so an authenticated user cannot
-- move a token to another restaurant or an inactive membership.
drop policy if exists user_push_tokens_update_self
  on public.user_push_tokens;

create policy user_push_tokens_update_self
  on public.user_push_tokens
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.team_members tm
      where tm.id = user_push_tokens.team_member_id
        and tm.user_id = (select auth.uid())
        and tm.restaurant_id = user_push_tokens.restaurant_id
        and tm.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.team_members tm
      where tm.id = user_push_tokens.team_member_id
        and tm.user_id = (select auth.uid())
        and tm.restaurant_id = user_push_tokens.restaurant_id
        and tm.is_active = true
    )
  );

-- Explicit grants are required for new Data API exposure defaults rolling out
-- in 2026. RLS remains the row-level authorization boundary.
revoke all on table public.user_push_tokens from anon;
grant select, insert, update, delete
  on table public.user_push_tokens to authenticated;
grant select, insert, update, delete
  on table public.user_push_tokens to service_role;

-- Existing policies intentionally left unchanged:
--   user_push_tokens_select_self
--   user_push_tokens_insert_self
--   user_push_tokens_delete_self
-- Their names and definitions are present in the shared source migration. The
-- UPDATE policy above was the only one missing restaurant equality in WITH CHECK.

-- Verification (run after applying in a controlled environment):
--
-- select column_name, data_type, column_default, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'user_push_tokens'
--   and column_name in (
--     'app_id', 'updated_at', 'disabled_reason', 'last_error_at'
--   )
-- order by column_name;
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename = 'user_push_tokens'
-- order by indexname;
--
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'user_push_tokens'
-- order by policyname;
--
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name = 'user_push_tokens'
--   and grantee in ('anon', 'authenticated', 'service_role')
-- order by grantee, privilege_type;
--
-- -- Must return no duplicates before mobile registration is enabled:
-- select team_member_id, app_id, device_id, count(*)
-- from public.user_push_tokens
-- where device_id is not null
-- group by team_member_id, app_id, device_id
-- having count(*) > 1;
