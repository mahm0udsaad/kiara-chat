-- Mobile inbox reliability contracts: a retried outbound request may create
-- only one message, and typing broadcasts are visible only to active Kiara
-- operations members.

\set ON_ERROR_STOP on
set client_min_messages = notice;

insert into public.messages (
  conversation_id, role, content, client_request_id
) values (
  'd0000000-0000-0000-0000-000000000001',
  'agent',
  'first attempt',
  '90000000-0000-0000-0000-000000000001'
);

do $$
begin
  perform kiara_test.raises(
    $sql$
      insert into public.messages (
        conversation_id, role, content, client_request_id
      ) values (
        'd0000000-0000-0000-0000-000000000001',
        'agent',
        'retry',
        '90000000-0000-0000-0000-000000000001'
      )
    $sql$,
    'duplicate key',
    'same conversation and request id cannot create a second message'
  );

  perform kiara_test.ok(
    (select count(*) from public.messages
      where client_request_id = '90000000-0000-0000-0000-000000000001') = 1,
    'retry id remains attached to exactly one message'
  );
end
$$;

insert into realtime.messages (topic, extension, payload)
values ('kiara-presence', 'broadcast', '{"conversationId":"d0000000-0000-0000-0000-000000000001"}');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local realtime.topic = 'kiara-presence';
select kiara_test.ok(
  (select count(*) from realtime.messages where topic = 'kiara-presence') = 1,
  'active Kiara member can receive the private typing topic'
);
commit;

-- Employee app presence is server-owned accountability data. The service role
-- can record it, while the privilege matrix verifies API roles cannot inspect
-- or forge another employee's online state.
set role service_role;
insert into public.team_member_app_presence (
  team_member_id, restaurant_id, state, platform, last_active_at
) values (
  'a0000000-0000-0000-0000-000000000002',
  '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
  'active',
  'android',
  now()
)
on conflict (team_member_id) do update
set state = excluded.state,
    platform = excluded.platform,
    last_seen_at = now(),
    last_active_at = now();

select kiara_test.ok(
  (select state = 'active' and platform = 'android'
     from public.team_member_app_presence
    where team_member_id = 'a0000000-0000-0000-0000-000000000002'),
  'service route can record an employee heartbeat'
);
reset role;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
set local realtime.topic = 'kiara-presence';
select kiara_test.ok(
  (select count(*) from realtime.messages where topic = 'kiara-presence') = 0,
  'authenticated outsider cannot receive the private typing topic'
);
commit;
