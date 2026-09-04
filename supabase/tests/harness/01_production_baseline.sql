-- The production tables the pending migrations build on, captured read-only
-- from project `nkdkqgrkyqpjdaifazwn` on 2026-08-11 (structure only, no rows).
--
-- Only the tables the migrations reference are reproduced. If a migration ever
-- starts touching another table, add it here rather than weakening the test.

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_number text
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  name_ar text,
  country text default 'SA' check (country in ('SA', 'EG')),
  currency text default 'SAR' check (currency in ('SAR', 'EGP')),
  timezone text default 'Asia/Riyadh',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary_whatsapp_number_id uuid references public.whatsapp_numbers(id) on delete set null,
  provisioning_status text not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  ai_enabled boolean not null default true
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'agent' check (role in ('admin', 'agent')),
  full_name text not null,
  is_active boolean not null default true,
  is_available boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint team_members_restaurant_user_key unique (restaurant_id, user_id)
);

create table if not exists public.specialists (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  full_name text not null,
  phone text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  nationality text
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  full_name text not null,
  phone text not null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_phone text not null,
  customer_name text,
  status text default 'active' check (status in ('active', 'resolved', 'escalated')),
  started_at timestamptz default now(),
  last_message_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb,
  last_inbound_at timestamptz,
  bot_paused boolean not null default false,
  assigned_to uuid references public.team_members(id) on delete set null,
  assigned_at timestamptz,
  handler_mode text default 'unassigned' check (handler_mode in ('unassigned', 'human', 'bot')),
  assigned_by_user_id uuid references auth.users(id),
  unread_count integer not null default 0,
  last_read_at timestamptz,
  archived_at timestamptz
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('customer', 'agent', 'system')),
  content text not null,
  message_type text default 'text',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  delivery_status text,
  error_message text,
  external_message_sid text,
  twilio_message_sid text,
  twilio_status text,
  external_error_code text,
  channel text not null default 'whatsapp',
  sender_team_member_id uuid
);

create table if not exists public.conversation_claim_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  mode text not null check (mode in ('human', 'bot')),
  claimed_at timestamptz not null default now(),
  claimed_by_user_id uuid references auth.users(id),
  event_type text not null default 'claim'
    check (event_type in ('claim', 'reassign', 'force_bot', 'unassign'))
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  phone_number text not null constraint customers_phone_e164 check (phone_number ~ '^\+[1-9]\d{1,14}$'),
  full_name text,
  source text not null default 'manual'
    check (source in ('rekaz_import', 'manual', 'csv_import', 'conversation')),
  source_ref text,
  metadata jsonb not null default '{}'::jsonb,
  opted_out boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  specialist_id uuid references public.specialists(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  arrival_at timestamptz not null,
  customer_location text not null,
  customer_phone text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trip_type text not null default 'one_way' check (trip_type in ('one_way', 'round_trip')),
  price numeric(10, 2),
  updated_by uuid references public.team_members(id)
);

-- Production has RLS enabled on every one of these.
alter table public.profiles enable row level security;
alter table public.whatsapp_numbers enable row level security;
alter table public.restaurants enable row level security;
alter table public.team_members enable row level security;
alter table public.specialists enable row level security;
alter table public.drivers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_claim_events enable row level security;
alter table public.customers enable row level security;
alter table public.driver_orders enable row level security;

grant select, insert, update, delete on all tables in schema public to service_role;

-- `team_members` is readable by signed-in employees in production: the
-- Realtime inbox policy joins against it as the calling user.
grant select on public.team_members to authenticated;
create policy team_members_self_read on public.team_members
  for select to authenticated
  using (user_id = (select auth.uid()));
