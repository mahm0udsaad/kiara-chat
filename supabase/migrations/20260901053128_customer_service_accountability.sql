-- Authenticated app heartbeats power the owner's "active now" report. Clients
-- never read or write this table directly; both operations go through a
-- tenant-pinned server route using the service role.
create table if not exists public.team_member_app_presence (
  team_member_id uuid primary key
    references public.team_members(id) on delete cascade,
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  state text not null default 'background'
    check (state in ('active', 'background')),
  platform text not null
    check (platform in ('ios', 'android', 'web')),
  app_version text,
  last_seen_at timestamptz not null default now(),
  last_active_at timestamptz
);

create index if not exists team_member_app_presence_restaurant_seen_idx
  on public.team_member_app_presence (restaurant_id, last_seen_at desc);

alter table public.team_member_app_presence enable row level security;

revoke all on table public.team_member_app_presence from anon, authenticated;
grant select, insert, update, delete
  on table public.team_member_app_presence to service_role;

comment on table public.team_member_app_presence is
  'Server-written employee app heartbeat used only for owner accountability reporting.';
