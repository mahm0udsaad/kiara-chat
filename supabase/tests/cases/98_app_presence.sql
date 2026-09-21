-- What the owner report means by "وقتها في التطبيق".
--
-- The report showed employees a fraction of the hours they worked: جنات had
-- three visits spanning eight hours on 2026-09-21 and 0.00 h credited, and منه
-- carried 499 "sessions" in a day. The accumulator itself is sound — these
-- cases pin down what it credits, so the client change that feeds it can be
-- judged against something other than reasoning.
--
-- `record_employee_app_presence` reads the gap from the live presence row, so
-- a beat is aged here by moving that row's `last_seen_at` backwards rather
-- than by sleeping.

\set ON_ERROR_STOP on
set client_min_messages = notice;

\set member '\'a0000000-0000-0000-0000-000000000002\''
\set tenant '\'2ba8f6c8-aff9-4147-8f13-cdcb732de698\''

-- Ages the last beat by N seconds, so the next one sees a gap of that size.
create or replace function kiara_test.age_presence(p_member uuid, p_seconds integer)
returns void language sql as $$
  update public.team_member_app_presence
     set last_seen_at = last_seen_at - make_interval(secs => p_seconds)
   where team_member_id = p_member;
$$;

create or replace function kiara_test.credited(p_member uuid)
returns integer language sql as $$
  select coalesce(sum(active_seconds), 0)::integer
    from public.team_member_app_daily_presence
   where team_member_id = p_member;
$$;

create or replace function kiara_test.sessions(p_member uuid)
returns integer language sql as $$
  select coalesce(sum(sessions), 0)::integer
    from public.team_member_app_daily_presence
   where team_member_id = p_member;
$$;

do $$
declare
  v_member uuid := 'a0000000-0000-0000-0000-000000000002';
  v_tenant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
begin
  -- A short visit, the way the app used to report it: one active beat on
  -- open, then a background beat on the way out. This is the shape that put
  -- 0.00 h against a real morning's work.
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.age_presence(v_member, 30);
  perform public.record_employee_app_presence(v_member, v_tenant, 'background', 'android');
  perform kiara_test.ok(
    kiara_test.credited(v_member) = 0,
    'the old sequence credits nothing for a visit shorter than one heartbeat'
  );
  perform kiara_test.ok(
    kiara_test.sessions(v_member) = 1,
    'and still counts the visit as a session, which is how 0.00 h over hours happened'
  );

  -- The same visit as the app now reports it: one last active beat before the
  -- background one closes the stretch.
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.age_presence(v_member, 30);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.ok(
    kiara_test.credited(v_member) = 30,
    'the leaving beat credits the tail of a 30-second visit'
  );
  perform public.record_employee_app_presence(v_member, v_tenant, 'background', 'android');
  perform kiara_test.ok(
    kiara_test.credited(v_member) = 30,
    'and the background beat that follows it adds nothing on top'
  );

  -- Time away is not work: a return after the idle cutoff buys no credit and
  -- opens a new stretch, so the leaving beat cannot be used to bank hours.
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.age_presence(v_member, 3600);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.ok(
    kiara_test.credited(v_member) = 30,
    'an hour away credits nothing, however the beats are ordered'
  );

  -- The whole point of the daily row: closing the app and opening it again
  -- adds to today's total instead of starting it over.
  perform kiara_test.age_presence(v_member, 45);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.ok(
    kiara_test.credited(v_member) = 75,
    'a later visit adds to the day rather than replacing it'
  );

  -- A normal foreground stretch: consecutive beats inside the cutoff each buy
  -- their own gap, which is where a real shift's hours come from.
  perform kiara_test.age_presence(v_member, 45);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.age_presence(v_member, 45);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.ok(
    kiara_test.credited(v_member) = 165,
    'consecutive heartbeats accumulate the stretch'
  );
end $$;
