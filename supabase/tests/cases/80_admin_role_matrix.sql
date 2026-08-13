-- What the admin (Hanan) can do at the command wall that an agent cannot, and
-- what the audit trail records about her when she does it.
--
-- Seeded roles: a0000000-…0001 Hanan (admin), …0002 Huda (agent),
-- …0003 Nora (agent).

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- Price is the one field the role gate actually guards.
do $$
declare
  v_order uuid := 'e0000000-0000-0000-0000-000000000002';
  v_version bigint;
begin
  update public.driver_orders
  set version = 1, status = 'pending', dispatch_state = 'idle',
      active_dispatch_command_id = null, price = null
  where id = v_order;

  perform kiara_test.raises(
    $q$select public.kiara_command_update_driver_order(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        1, gen_random_uuid(),
        '22222222-2222-2222-2222-222222222222'::uuid,
        'a0000000-0000-0000-0000-000000000002'::uuid,
        'agent', '{"price": 500}'::jsonb)$q$,
    'ORDER_PRICE_FORBIDDEN',
    'an agent cannot set the price'
  );

  perform public.kiara_command_update_driver_order(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid, v_order,
    1, gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'admin', '{"price": 500}'::jsonb
  );
  perform kiara_test.ok(
    (select price from public.driver_orders where id = v_order) = 500,
    'the admin can set the price'
  );

  -- Everything else is open to both roles: an agent runs the day.
  select version into v_version from public.driver_orders where id = v_order;
  perform public.kiara_command_update_driver_order(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid, v_order,
    v_version, gen_random_uuid(),
    '22222222-2222-2222-2222-222222222222'::uuid,
    'a0000000-0000-0000-0000-000000000002'::uuid,
    'agent', '{"durationMinutes": 45}'::jsonb
  );
  perform kiara_test.ok(
    (select duration_minutes from public.driver_orders where id = v_order) = 45,
    'an agent can still edit the visit itself'
  );

  -- Admin is not a bypass for the conflict wall. Being Hanan does not let her
  -- overwrite an edit she has not seen.
  perform kiara_test.raises(
    $q$select public.kiara_command_update_driver_order(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        1, gen_random_uuid(),
        '11111111-1111-1111-1111-111111111111'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid,
        'admin', '{"durationMinutes": 200}'::jsonb)$q$,
    'ORDER_VERSION_CONFLICT',
    'the admin is subject to the same version conflict as everyone'
  );

  -- Nor does admin reach across tenants.
  perform kiara_test.raises(
    $q$select public.kiara_command_update_driver_order(
        'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        1, gen_random_uuid(),
        '11111111-1111-1111-1111-111111111111'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid,
        'admin', '{"durationMinutes": 60}'::jsonb)$q$,
    'ORDER_NOT_FOUND',
    'the admin cannot address another tenant''s order'
  );
end
$$;

-- What the owner report can actually prove about who acted.
do $$
declare
  v_admin_event public.operation_events%rowtype;
  v_agent_event public.operation_events%rowtype;
begin
  select * into v_admin_event
  from public.operation_events
  where actor_team_member_id = 'a0000000-0000-0000-0000-000000000001'
  order by occurred_at desc limit 1;

  select * into v_agent_event
  from public.operation_events
  where actor_team_member_id = 'a0000000-0000-0000-0000-000000000002'
  order by occurred_at desc limit 1;

  perform kiara_test.ok(
    v_admin_event.actor_team_member_id is not null
      and v_admin_event.actor_user_id is not null,
    'the event names the actor by both team member and auth user'
  );
  perform kiara_test.ok(
    v_admin_event.occurred_at is not null,
    'the event carries server time'
  );

  -- `actor_type` alone cannot separate them: it only records whether a
  -- team-member id was supplied, so both land as 'team_member'.
  perform kiara_test.ok(
    v_admin_event.actor_type = 'team_member'
      and v_agent_event.actor_type = 'team_member',
    'actor_type cannot distinguish an admin from an agent'
  );

  -- ...which is why the role is stored on the event itself. A report can now
  -- say "an admin did this" without joining `team_members` as it stands today,
  -- so promoting or deactivating someone cannot rewrite what the history says
  -- about actions they already took.
  perform kiara_test.ok(
    v_admin_event.actor_role = 'admin',
    'the admin''s event records the admin role at action time'
  );
  perform kiara_test.ok(
    v_agent_event.actor_role = 'agent',
    'the agent''s event records the agent role at action time'
  );

  -- Changing the roster now must not change what the old events say.
  update public.team_members set role = 'agent'
  where id = 'a0000000-0000-0000-0000-000000000001';
  perform kiara_test.ok(
    (select actor_role from public.operation_events where id = v_admin_event.id)
      = 'admin',
    'demoting the actor does not rewrite her past events'
  );
  update public.team_members set role = 'admin'
  where id = 'a0000000-0000-0000-0000-000000000001';
end
$$;

-- Field and system actors carry their role too, so a report can filter by who
-- kind of actor did something without four different joins.
do $$
begin
  perform kiara_test.ok(
    (select actor_role from public.operation_events
      where event_type = 'field.confirm_ride' limit 1) = 'driver',
    'a driver step records the driver role'
  );
  perform kiara_test.ok(
    (select actor_role from public.operation_events
      where event_type = 'field.confirm_pickup' limit 1) = 'specialist',
    'a specialist step records the specialist role'
  );
  perform kiara_test.ok(
    (select actor_role from public.operation_events
      where event_type = 'order.dispatch_completed' limit 1) = 'system',
    'the worker settling a dispatch is recorded as the system'
  );
  perform kiara_test.ok(
    (select actor_role from public.operation_events
      where event_type = 'rekaz.sync_completed' limit 1) = 'admin',
    'a Rekaz pull records who pulled it, by role'
  );

  -- The column is constrained, so a typo cannot quietly create a new "role".
  perform kiara_test.raises(
    $q$insert into public.operation_events
        (restaurant_id, aggregate_type, aggregate_id, event_type,
         actor_type, actor_role)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698',
         'driver_order', gen_random_uuid(), 'test.event',
         'team_member', 'superadmin')$q$,
    'operation_events_actor_role_check',
    'an unknown role is rejected'
  );
end
$$;
