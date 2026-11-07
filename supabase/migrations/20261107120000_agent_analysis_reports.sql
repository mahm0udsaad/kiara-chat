-- Saved AI reviews of customer-service employees.
--
-- The review costs a model call and up to a minute, and it vanished as soon as
-- the owner left the screen. Each run is now kept, so the screen opens on the
-- latest review and earlier ones stay one tap away until she runs it again.
--
-- Written and read by the server with the service role only. No policies:
-- nothing here is queried by an app user directly.

create table if not exists public.agent_analysis_reports (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  -- The employee the review is about.
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  -- Who ran it (the owner's team_members row); kept if that row goes.
  requested_by uuid references public.team_members(id) on delete set null,
  period_from date not null,
  period_to date not null,
  start_time text not null,
  end_time text not null,
  -- The whole review as the app renders it.
  report jsonb not null,
  ai_unavailable boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists agent_analysis_reports_member_recent_idx
  on public.agent_analysis_reports (restaurant_id, team_member_id, created_at desc);

alter table public.agent_analysis_reports enable row level security;
revoke all on public.agent_analysis_reports from public, anon, authenticated;
grant select, insert, delete on public.agent_analysis_reports to service_role;
