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

-- ---------------------------------------------------------------------------
-- Tenant-membership RLS as it stood on `ugbplqgrheovlfgolsjf` on 2026-10-16,
-- captured read-only (pg_proc / pg_policies), so the migration that replaces
-- the per-row helper calls is proven against the policies it actually edits.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists is_super_admin boolean not null default false;

create or replace function public.is_restaurant_member(p_restaurant_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    p_user_id is not null
    and p_restaurant_id is not null
    and (
      exists (
        select 1 from public.restaurants r
        where r.id = p_restaurant_id and r.owner_id = p_user_id
      )
      or exists (
        select 1 from public.team_members tm
        where tm.restaurant_id = p_restaurant_id
          and tm.user_id = p_user_id
          and tm.is_active = true
      )
      or exists (
        select 1 from public.profiles pr
        where pr.id = p_user_id and pr.is_super_admin = true
      )
    );
$$;

create or replace function public.is_restaurant_admin(p_restaurant_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    p_user_id is not null
    and p_restaurant_id is not null
    and (
      exists (
        select 1 from public.restaurants r
         where r.id = p_restaurant_id
           and r.owner_id = p_user_id
      )
      or exists (
        select 1 from public.team_members tm
         where tm.restaurant_id = p_restaurant_id
           and tm.user_id = p_user_id
           and tm.is_active = true
           and tm.role = 'admin'
      )
      or exists (
        select 1 from public.profiles pr
         where pr.id = p_user_id
           and pr.is_super_admin = true
      )
    );
$$;

create or replace function public.can_access_conversation(p_conversation_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and public.is_restaurant_member(c.restaurant_id, p_user_id)
  );
$$;

create table if not exists public.conversation_labels (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  color text not null default 'slate',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (restaurant_id, name)
);

create table if not exists public.conversation_label_assignments (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  label_id uuid not null references public.conversation_labels(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id),
  primary key (conversation_id, label_id)
);
create index if not exists conversation_label_assignments_conv_idx
  on public.conversation_label_assignments (conversation_id);

alter table public.conversation_labels enable row level security;
alter table public.conversation_label_assignments enable row level security;

create policy "Owners can view conversations" on public.conversations
  using (restaurant_id in (select r.id from public.restaurants r where r.owner_id = (select auth.uid())));
create policy conversations_select_members on public.conversations
  for select using (public.is_restaurant_member(restaurant_id, (select auth.uid())));
create policy conversations_update_members on public.conversations
  for update using (public.is_restaurant_member(restaurant_id, (select auth.uid())))
  with check (public.is_restaurant_member(restaurant_id, (select auth.uid())));

create policy "Owners can view messages" on public.messages
  using (conversation_id in (
    select c.id from public.conversations c
      join public.restaurants r on c.restaurant_id = r.id
     where r.owner_id = (select auth.uid())));
create policy messages_select_members on public.messages
  for select using (public.can_access_conversation(conversation_id, (select auth.uid())));

create policy cla_select on public.conversation_label_assignments
  for select using (exists (select 1 from public.conversations c
    where c.id = conversation_label_assignments.conversation_id
      and public.is_restaurant_member(c.restaurant_id, auth.uid())));
create policy cla_insert on public.conversation_label_assignments
  for insert with check (exists (select 1 from public.conversations c
    where c.id = conversation_label_assignments.conversation_id
      and public.is_restaurant_member(c.restaurant_id, auth.uid())));
create policy cla_delete on public.conversation_label_assignments
  for delete using (exists (select 1 from public.conversations c
    where c.id = conversation_label_assignments.conversation_id
      and public.is_restaurant_member(c.restaurant_id, auth.uid())));

create policy conversation_labels_select on public.conversation_labels
  for select using (public.is_restaurant_member(restaurant_id, auth.uid()));
create policy conversation_labels_insert on public.conversation_labels
  for insert with check (public.is_restaurant_member(restaurant_id, auth.uid()));
create policy conversation_labels_update on public.conversation_labels
  for update using (public.is_restaurant_member(restaurant_id, auth.uid()))
  with check (public.is_restaurant_member(restaurant_id, auth.uid()));
create policy conversation_labels_delete on public.conversation_labels
  for delete using (public.is_restaurant_admin(restaurant_id, auth.uid()));

create policy driver_orders_select on public.driver_orders
  for select using (public.is_restaurant_member(restaurant_id, (select auth.uid())));
create policy driver_orders_insert on public.driver_orders
  for insert with check (public.is_restaurant_member(restaurant_id, (select auth.uid())));
create policy driver_orders_update on public.driver_orders
  for update using (public.is_restaurant_member(restaurant_id, (select auth.uid())))
  with check (public.is_restaurant_member(restaurant_id, (select auth.uid())));

create policy drivers_select on public.drivers
  for select using (public.is_restaurant_member(restaurant_id, (select auth.uid())));
create policy drivers_insert on public.drivers
  for insert with check (public.is_restaurant_admin(restaurant_id, (select auth.uid())));
create policy drivers_update on public.drivers
  for update using (public.is_restaurant_admin(restaurant_id, (select auth.uid())))
  with check (public.is_restaurant_admin(restaurant_id, (select auth.uid())));
create policy drivers_delete on public.drivers
  for delete using (public.is_restaurant_admin(restaurant_id, (select auth.uid())));

create policy specialists_select on public.specialists
  for select using (public.is_restaurant_member(restaurant_id, (select auth.uid())));
create policy specialists_insert on public.specialists
  for insert with check (public.is_restaurant_admin(restaurant_id, (select auth.uid())));
create policy specialists_update on public.specialists
  for update using (public.is_restaurant_admin(restaurant_id, (select auth.uid())))
  with check (public.is_restaurant_admin(restaurant_id, (select auth.uid())));
create policy specialists_delete on public.specialists
  for delete using (public.is_restaurant_admin(restaurant_id, (select auth.uid())));

grant select, insert, update, delete on public.conversation_labels, public.conversation_label_assignments to service_role;
