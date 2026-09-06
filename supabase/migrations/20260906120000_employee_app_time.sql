-- Time each employee actually spends in the app, per day.
--
-- `team_member_app_presence` is keyed on the member alone, so every heartbeat
-- overwrites the previous one and no history survives — it can say "online now"
-- but never "online for how long". Rather than log all ~640 heartbeats a shift
-- produces per employee, each beat credits the gap since the previous one to a
-- single per-day counter: the same answer, one row per employee per day, with
-- nothing to prune later.
--
-- A gap longer than the cutoff means the app was closed or asleep rather than
-- watched, so it is credited as nothing and counted as a new session instead.
-- Accumulating inside one function keeps two devices heartbeating at the same
-- moment from each crediting the same gap.

create table if not exists public.team_member_app_daily_presence (
  team_member_id uuid not null
    references public.team_members(id) on delete cascade,
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  day date not null,
  active_seconds integer not null default 0 check (active_seconds >= 0),
  sessions integer not null default 0 check (sessions >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (team_member_id, day)
);

create index if not exists team_member_app_daily_presence_restaurant_day_idx
  on public.team_member_app_daily_presence (restaurant_id, day desc);

alter table public.team_member_app_daily_presence enable row level security;

revoke all on table public.team_member_app_daily_presence from anon, authenticated;
grant select, insert, update, delete
  on table public.team_member_app_daily_presence to service_role;

comment on table public.team_member_app_daily_presence is
  'Server-written per-day rollup of employee app time, accumulated from heartbeats for owner accountability reporting.';
comment on column public.team_member_app_daily_presence.active_seconds is
  'Sum of gaps between consecutive active heartbeats, excluding gaps longer than the idle cutoff.';
comment on column public.team_member_app_daily_presence.sessions is
  'Stretches of use: incremented whenever a heartbeat follows a gap longer than the idle cutoff.';

/**
 * Record one heartbeat: refresh the live presence row and credit the elapsed
 * time to the employee's day, atomically so concurrent devices cannot both
 * credit the same gap.
 */
create or replace function public.record_employee_app_presence(
  p_team_member_id uuid,
  p_restaurant_id uuid,
  p_state text,
  p_platform text,
  p_app_version text default null,
  p_idle_cutoff_seconds integer default 120,
  p_time_zone text default 'Asia/Riyadh'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_previous_seen_at timestamptz;
  v_previous_state text;
  v_gap_seconds numeric;
  v_credit integer := 0;
  v_new_session integer := 0;
  v_day date := (v_now at time zone p_time_zone)::date;
begin
  if p_team_member_id is null or p_restaurant_id is null then
    raise exception 'missing_arguments';
  end if;
  if p_state not in ('active', 'background') then
    raise exception 'invalid_state';
  end if;
  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'invalid_platform';
  end if;

  -- Locks the live row for the rest of the statement, so a phone and a laptop
  -- beating in the same millisecond are serialised instead of both reading the
  -- same previous timestamp and each crediting the gap it describes.
  select last_seen_at, state
    into v_previous_seen_at, v_previous_state
    from public.team_member_app_presence
   where team_member_id = p_team_member_id
     for update;

  if p_state = 'active' then
    if v_previous_seen_at is null or v_previous_state is distinct from 'active' then
      v_new_session := 1;
    else
      v_gap_seconds := extract(epoch from (v_now - v_previous_seen_at));
      if v_gap_seconds > 0 and v_gap_seconds <= p_idle_cutoff_seconds then
        v_credit := floor(v_gap_seconds)::integer;
      else
        -- Longer than the cutoff: the app was not being watched across that
        -- gap, so it buys no time and opens a new stretch.
        v_new_session := 1;
      end if;
    end if;
  end if;

  insert into public.team_member_app_presence as presence (
    team_member_id, restaurant_id, state, platform, app_version,
    last_seen_at, last_active_at
  )
  values (
    p_team_member_id, p_restaurant_id, p_state, p_platform, p_app_version,
    v_now, case when p_state = 'active' then v_now else null end
  )
  on conflict (team_member_id) do update set
    restaurant_id = excluded.restaurant_id,
    state = excluded.state,
    platform = excluded.platform,
    app_version = excluded.app_version,
    last_seen_at = excluded.last_seen_at,
    last_active_at = case
      when p_state = 'active' then v_now
      else presence.last_active_at
    end;

  -- Only foreground time is worth counting; a background beat exists to close
  -- the stretch, which the presence row above has already recorded.
  if p_state = 'active' then
    insert into public.team_member_app_daily_presence as daily (
      team_member_id, restaurant_id, day, active_seconds, sessions,
      first_seen_at, last_seen_at
    )
    values (
      p_team_member_id, p_restaurant_id, v_day, v_credit, greatest(v_new_session, 1),
      v_now, v_now
    )
    on conflict (team_member_id, day) do update set
      active_seconds = daily.active_seconds + v_credit,
      sessions = daily.sessions + v_new_session,
      last_seen_at = v_now;
  end if;
end;
$$;

revoke all on function public.record_employee_app_presence(
  uuid, uuid, text, text, text, integer, text
) from anon, authenticated;
grant execute on function public.record_employee_app_presence(
  uuid, uuid, text, text, text, integer, text
) to service_role;
