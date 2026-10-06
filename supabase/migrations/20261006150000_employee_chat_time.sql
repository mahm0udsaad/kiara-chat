-- Time each employee spends inside a conversation, beside time in the app.
--
-- "وقتها داخل التطبيق" counted every foreground minute: an inbox list left
-- open, the reports, the orders calendar. The owner wants who is actually
-- working the chats, so each beat now also says which screen it came from,
-- and the gap that started on an open conversation is credited to a second
-- counter, `chat_seconds`. App time is unchanged and still recorded.
--
-- The gap belongs to the screen it started on: the beat that leaves a chat
-- (or the app) credits the time since the previous chat beat to chat, and the
-- beat that enters one credits nothing to it. The phone or browser reports
-- `chat` only while the employee has touched or typed in the last few minutes,
-- so a conversation left open on a desk does not bank hours.
--
-- Additive for old apps: `p_screen` defaults to 'other', so a build that
-- predates it keeps crediting app time exactly as before and no chat time.

alter table public.team_member_app_presence
  add column if not exists screen text not null default 'other'
    check (screen in ('chat', 'other'));

alter table public.team_member_app_daily_presence
  add column if not exists chat_seconds integer not null default 0
    check (chat_seconds >= 0);

comment on column public.team_member_app_daily_presence.chat_seconds is
  'Part of active_seconds spent on an open conversation with recent interaction.';

-- Replaced rather than overloaded: two versions differing only by a defaulted
-- argument would make every existing call ambiguous.
drop function if exists public.record_employee_app_presence(
  uuid, uuid, text, text, text, integer, text
);

create or replace function public.record_employee_app_presence(
  p_team_member_id uuid,
  p_restaurant_id uuid,
  p_state text,
  p_platform text,
  p_app_version text default null,
  p_idle_cutoff_seconds integer default 120,
  p_time_zone text default 'Asia/Riyadh',
  p_screen text default 'other'
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
  v_previous_screen text;
  v_gap_seconds numeric;
  v_credit integer := 0;
  v_chat_credit integer := 0;
  v_new_session integer := 0;
  v_day date := (v_now at time zone p_time_zone)::date;
  v_screen text := coalesce(p_screen, 'other');
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
  if v_screen not in ('chat', 'other') then
    raise exception 'invalid_screen';
  end if;

  -- Locks the live row for the rest of the statement, so a phone and a laptop
  -- beating in the same millisecond are serialised instead of both reading the
  -- same previous timestamp and each crediting the gap it describes.
  select last_seen_at, state, screen
    into v_previous_seen_at, v_previous_state, v_previous_screen
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
        -- The gap was spent on whatever screen the previous beat came from.
        if v_previous_screen = 'chat' then
          v_chat_credit := v_credit;
        end if;
      else
        -- Longer than the cutoff: the app was not being watched across that
        -- gap, so it buys no time and opens a new stretch.
        v_new_session := 1;
      end if;
    end if;
  end if;

  insert into public.team_member_app_presence as presence (
    team_member_id, restaurant_id, state, platform, app_version,
    last_seen_at, last_active_at, screen
  )
  values (
    p_team_member_id, p_restaurant_id, p_state, p_platform, p_app_version,
    v_now, case when p_state = 'active' then v_now else null end,
    case when p_state = 'active' then v_screen else 'other' end
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
    end,
    screen = excluded.screen;

  -- Only foreground time is worth counting; a background beat exists to close
  -- the stretch, which the presence row above has already recorded.
  if p_state = 'active' then
    insert into public.team_member_app_daily_presence as daily (
      team_member_id, restaurant_id, day, active_seconds, chat_seconds, sessions,
      first_seen_at, last_seen_at
    )
    values (
      p_team_member_id, p_restaurant_id, v_day, v_credit, v_chat_credit,
      greatest(v_new_session, 1), v_now, v_now
    )
    on conflict (team_member_id, day) do update set
      active_seconds = daily.active_seconds + v_credit,
      chat_seconds = daily.chat_seconds + v_chat_credit,
      sessions = daily.sessions + v_new_session,
      last_seen_at = v_now;
  end if;
end;
$$;

revoke all on function public.record_employee_app_presence(
  uuid, uuid, text, text, text, integer, text, text
) from public, anon, authenticated;
grant execute on function public.record_employee_app_presence(
  uuid, uuid, text, text, text, integer, text, text
) to service_role;
