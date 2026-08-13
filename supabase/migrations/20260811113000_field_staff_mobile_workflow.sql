-- Authenticated mobile workflow for Kiara specialists and drivers.
-- Auth users are provisioned by an admin with phone + password. The password
-- itself is never stored in public tables; Supabase Auth stores its hash.

create table if not exists public.field_staff_accounts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('specialist', 'driver')),
  specialist_id uuid references public.specialists(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete cascade,
  is_active boolean not null default true,
  last_app_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_staff_accounts_role_roster_check check (
    (role = 'specialist' and specialist_id is not null and driver_id is null)
    or
    (role = 'driver' and driver_id is not null and specialist_id is null)
  )
);

create unique index if not exists field_staff_accounts_specialist_key
  on public.field_staff_accounts (specialist_id)
  where specialist_id is not null;

create unique index if not exists field_staff_accounts_driver_key
  on public.field_staff_accounts (driver_id)
  where driver_id is not null;

create index if not exists field_staff_accounts_auth_active_idx
  on public.field_staff_accounts (auth_user_id)
  where is_active = true;

create table if not exists public.field_order_progress (
  order_id uuid primary key references public.driver_orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  driver_confirmed_at timestamptz,
  specialist_pickup_at timestamptz,
  service_started_at timestamptz,
  completed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_order_progress_sequence_check check (
    (specialist_pickup_at is null or driver_confirmed_at is not null)
    and (service_started_at is null or specialist_pickup_at is not null)
    and (completed_at is null or service_started_at is not null)
  )
);

create index if not exists field_order_progress_pending_reminders_idx
  on public.field_order_progress (last_activity_at)
  where completed_at is null;

create table if not exists public.field_staff_push_tokens (
  id uuid primary key default gen_random_uuid(),
  field_staff_account_id uuid not null
    references public.field_staff_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  expo_token text not null,
  device_id text not null,
  disabled boolean not null default false,
  disabled_reason text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- `standard_conforming_strings` is on, so a backslash in a plain literal is
  -- already literal: `\\[` asks the regex for a backslash followed by `[`, and
  -- no real Expo token contains one. Single backslashes here.
  constraint field_staff_push_tokens_expo_check
    check (expo_token ~ '^ExponentPushToken\[[^]]+\]$|^ExpoPushToken\[[^]]+\]$'),
  constraint field_staff_push_tokens_device_check
    check (char_length(btrim(device_id)) between 8 and 200)
);

create unique index if not exists field_staff_push_tokens_account_device_key
  on public.field_staff_push_tokens (field_staff_account_id, device_id);

create unique index if not exists field_staff_push_tokens_expo_key
  on public.field_staff_push_tokens (expo_token);

create index if not exists field_staff_push_tokens_active_idx
  on public.field_staff_push_tokens (field_staff_account_id)
  where disabled = false;

alter table public.field_staff_accounts enable row level security;
alter table public.field_order_progress enable row level security;
alter table public.field_staff_push_tokens enable row level security;

-- Mobile clients use the authenticated Next.js API. Keep these workflow tables
-- out of the Data API so every read/action is role- and order-scoped server-side.
revoke all on table public.field_staff_accounts from anon, authenticated;
revoke all on table public.field_order_progress from anon, authenticated;
revoke all on table public.field_staff_push_tokens from anon, authenticated;
grant select, insert, update, delete on table public.field_staff_accounts to service_role;
grant select, insert, update, delete on table public.field_order_progress to service_role;
grant select, insert, update, delete on table public.field_staff_push_tokens to service_role;

create schema if not exists kiara_private;
revoke all on schema kiara_private from public, anon, authenticated;

create or replace function kiara_private.tg_touch_field_workflow_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function kiara_private.tg_touch_field_workflow_updated_at()
  from public, anon, authenticated;

drop trigger if exists touch_field_staff_accounts_updated_at
  on public.field_staff_accounts;
create trigger touch_field_staff_accounts_updated_at
  before update on public.field_staff_accounts
  for each row execute function kiara_private.tg_touch_field_workflow_updated_at();

drop trigger if exists touch_field_order_progress_updated_at
  on public.field_order_progress;
create trigger touch_field_order_progress_updated_at
  before update on public.field_order_progress
  for each row execute function kiara_private.tg_touch_field_workflow_updated_at();

drop trigger if exists touch_field_staff_push_tokens_updated_at
  on public.field_staff_push_tokens;
create trigger touch_field_staff_push_tokens_updated_at
  before update on public.field_staff_push_tokens
  for each row execute function kiara_private.tg_touch_field_workflow_updated_at();
