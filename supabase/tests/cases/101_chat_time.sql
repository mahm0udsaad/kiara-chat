-- What the owner report means by "وقتها في المحادثات".
--
-- A gap is credited to chat time when the beat that opened it came from an
-- open conversation, and to app time either way. Entering a chat buys no chat
-- time for the stretch before it; leaving one keeps the stretch spent inside.
-- A build that sends no screen keeps crediting app time only.

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- Sorts before 98_app_presence, so it brings the same ageing helper with it.
create or replace function kiara_test.age_presence(p_member uuid, p_seconds integer)
returns void language sql as $$
  update public.team_member_app_presence
     set last_seen_at = last_seen_at - make_interval(secs => p_seconds)
   where team_member_id = p_member;
$$;

create or replace function kiara_test.chat_credited(p_member uuid)
returns integer language sql as $$
  select coalesce(sum(chat_seconds), 0)::integer
    from public.team_member_app_daily_presence
   where team_member_id = p_member;
$$;

do $$
declare
  -- A member of its own, so 98_app_presence's totals stay its own.
  v_member uuid := 'a0000000-0000-0000-0000-000000000003';
  v_tenant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  v_app integer;
begin
  if not exists (select 1 from public.team_members where id = v_member) then
    insert into public.team_members (id, restaurant_id, user_id, role, full_name)
    select v_member, v_tenant, user_id, role, 'Chat Time Test'
      from public.team_members where id = 'a0000000-0000-0000-0000-000000000002';
  end if;

  -- On the inbox list: app time only.
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android', null, 120, 'Asia/Riyadh', 'other');
  perform kiara_test.age_presence(v_member, 40);
  -- Opens a conversation: the 40 s before it were spent on the list.
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android', null, 120, 'Asia/Riyadh', 'chat');
  perform kiara_test.ok(kiara_test.chat_credited(v_member) = 0, 'time on the list before opening a chat is not chat time');

  perform kiara_test.age_presence(v_member, 45);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android', null, 120, 'Asia/Riyadh', 'chat');
  perform kiara_test.age_presence(v_member, 20);
  -- Goes back to the list: the 20 s tail inside the chat still counts.
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android', null, 120, 'Asia/Riyadh', 'other');
  perform kiara_test.ok(kiara_test.chat_credited(v_member) = 65, 'a chat stretch is credited in full, including the beat that leaves it');

  select coalesce(sum(active_seconds), 0)::integer into v_app
    from public.team_member_app_daily_presence where team_member_id = v_member;
  perform kiara_test.ok(v_app = 105, 'app time still counts every foreground second, chat or not');

  -- Back in a chat, then the phone is put away for an hour.
  perform kiara_test.age_presence(v_member, 30);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android', null, 120, 'Asia/Riyadh', 'chat');
  perform kiara_test.age_presence(v_member, 3600);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android', null, 120, 'Asia/Riyadh', 'chat');
  perform kiara_test.ok(kiara_test.chat_credited(v_member) = 65, 'a gap past the idle cutoff is not chat time either');

  -- A background beat ends the stretch, so the next chat beat starts fresh.
  perform public.record_employee_app_presence(v_member, v_tenant, 'background', 'android', null, 120, 'Asia/Riyadh', 'chat');
  perform kiara_test.age_presence(v_member, 30);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android', null, 120, 'Asia/Riyadh', 'chat');
  perform kiara_test.ok(kiara_test.chat_credited(v_member) = 65, 'time while backgrounded is never chat time');

  -- An app that predates the screen argument: app time as before, no chat time.
  perform kiara_test.age_presence(v_member, 45);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.age_presence(v_member, 45);
  perform public.record_employee_app_presence(v_member, v_tenant, 'active', 'android');
  perform kiara_test.ok(
    kiara_test.chat_credited(v_member) = 65 + 45,
    'the old call shape still works; only the gap that started in a chat is chat time'
  );

  perform kiara_test.raises(
    format(
      $q$select public.record_employee_app_presence(%L, %L, 'active', 'android', null, 120, 'Asia/Riyadh', 'settings')$q$,
      v_member, v_tenant
    ),
    'invalid_screen',
    'an unknown screen is refused'
  );

  perform kiara_test.ok(
    not has_function_privilege('anon', 'public.record_employee_app_presence(uuid, uuid, text, text, text, integer, text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_employee_app_presence(uuid, uuid, text, text, text, integer, text, text)', 'execute'),
    'clients cannot credit time to themselves'
  );
end $$;
