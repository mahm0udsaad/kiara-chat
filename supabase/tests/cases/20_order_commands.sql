-- Matrix 1-3: expected-version conflicts, idempotency replay and key reuse on
-- `kiara_command_update_driver_order`.

\set ON_ERROR_STOP on
\set tenant '2ba8f6c8-aff9-4147-8f13-cdcb732de698'
\set order1 'e0000000-0000-0000-0000-000000000001'
\set order2 'e0000000-0000-0000-0000-000000000002'
\set admin_user '11111111-1111-1111-1111-111111111111'
\set admin_tm 'a0000000-0000-0000-0000-000000000001'
\set agent_tm 'a0000000-0000-0000-0000-000000000002'
set client_min_messages = notice;

do $$
declare
  v_key uuid := '0a000000-0000-0000-0000-000000000001';
  v_result jsonb;
  v_version bigint;
begin
  perform kiara_test.ok(
    (select version from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000001') = 1,
    'a migrated order starts at version 1'
  );

  -- Happy path.
  v_result := public.kiara_command_update_driver_order(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
    'e0000000-0000-0000-0000-000000000001'::uuid,
    1, v_key,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'admin',
    jsonb_build_object('durationMinutes', 120, 'customerLocation', 'حي الياسمين')
  );
  perform kiara_test.ok(
    (v_result->>'replayed')::boolean is false,
    'first update is not a replay'
  );
  select version into v_version from public.driver_orders
    where id = 'e0000000-0000-0000-0000-000000000001';
  perform kiara_test.ok(v_version = 2, 'version increments to 2');
  perform kiara_test.ok(
    (select duration_minutes from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000001') = 120,
    'the patch is applied'
  );

  -- Matrix 2: same key replays the original response without a second write.
  v_result := public.kiara_command_update_driver_order(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
    'e0000000-0000-0000-0000-000000000001'::uuid,
    1, v_key,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'admin',
    jsonb_build_object('durationMinutes', 300)
  );
  perform kiara_test.ok(
    (v_result->>'replayed')::boolean is true,
    'replaying the key returns the original result'
  );
  perform kiara_test.ok(
    (select version from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000001') = 2,
    'a replay does not bump the version'
  );
  perform kiara_test.ok(
    (select duration_minutes from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000001') = 120,
    'a replay does not apply the second patch'
  );
  perform kiara_test.ok(
    (select count(*) from public.operation_events
      where aggregate_id = 'e0000000-0000-0000-0000-000000000001'
        and event_type = 'order.updated') = 1,
    'a replay appends exactly one audit event in total'
  );
end
$$;

-- Matrix 1: a stale expected version is rejected, and the rejection carries the
-- current version plus who moved it.
do $$
declare
  v_detail text;
  v_message text;
begin
  begin
    perform public.kiara_command_update_driver_order(
      '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
      'e0000000-0000-0000-0000-000000000001'::uuid,
      1, gen_random_uuid(),
      '33333333-3333-3333-3333-333333333333'::uuid,
      'a0000000-0000-0000-0000-000000000003'::uuid,
      'agent',
      jsonb_build_object('durationMinutes', 45)
    );
    raise exception 'ASSERTION FAILED: a stale version was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics
      v_message = message_text,
      v_detail = pg_exception_detail;
    if v_message <> 'ORDER_VERSION_CONFLICT' then raise; end if;
  end;

  perform kiara_test.ok(
    v_message = 'ORDER_VERSION_CONFLICT',
    'stale update raises ORDER_VERSION_CONFLICT'
  );
  perform kiara_test.ok(
    (v_detail::jsonb->>'currentVersion')::bigint = 2,
    'the conflict reports the current version'
  );
  perform kiara_test.ok(
    (v_detail::jsonb->>'updatedBy') = 'a0000000-0000-0000-0000-000000000001',
    'the conflict names the employee who last changed it'
  );
end
$$;

-- Matrix 3: reusing a key for a different aggregate is rejected outright.
do $$
begin
  perform kiara_test.raises(
    $q$select public.kiara_command_update_driver_order(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        1, '0a000000-0000-0000-0000-000000000001'::uuid,
        '11111111-1111-1111-1111-111111111111'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid,
        'admin', '{"durationMinutes": 60}'::jsonb)$q$,
    'IDEMPOTENCY_KEY_REUSED',
    'a key reused for another order is rejected'
  );

  perform kiara_test.raises(
    $q$select public.kiara_command_prepare_order_dispatch(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000001'::uuid,
        2, '0a000000-0000-0000-0000-000000000001'::uuid,
        '11111111-1111-1111-1111-111111111111'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid,
        'admin',
        'b0000000-0000-0000-0000-000000000001'::uuid,
        'c0000000-0000-0000-0000-000000000001'::uuid,
        'one_way', 350, 'حي النرجس', 'ملاحظة السائق', 'ملاحظة الأخصائية', null,
        '+966500000001', '+966500000011')$q$,
    'IDEMPOTENCY_KEY_REUSED',
    'a key reused for a different command type is rejected'
  );
end
$$;

-- Role and patch walls.
do $$
begin
  perform kiara_test.raises(
    $q$select public.kiara_command_update_driver_order(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        1, gen_random_uuid(),
        '44444444-4444-4444-4444-444444444444'::uuid, null,
        'driver', '{"durationMinutes": 60}'::jsonb)$q$,
    'ORDER_FORBIDDEN',
    'a driver cannot run the order-edit command'
  );

  perform kiara_test.raises(
    $q$select public.kiara_command_update_driver_order(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        1, gen_random_uuid(),
        '22222222-2222-2222-2222-222222222222'::uuid,
        'a0000000-0000-0000-0000-000000000002'::uuid,
        'agent', '{"price": 500}'::jsonb)$q$,
    'ORDER_PRICE_FORBIDDEN',
    'an agent cannot change the price'
  );

  perform kiara_test.raises(
    $q$select public.kiara_command_update_driver_order(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        1, gen_random_uuid(),
        '11111111-1111-1111-1111-111111111111'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid,
        'admin', '{"status": "sent"}'::jsonb)$q$,
    'ORDER_PATCH_INVALID',
    'an unlisted patch field is rejected'
  );

  -- Cross-tenant: the same order id under another tenant must not resolve.
  perform kiara_test.raises(
    $q$select public.kiara_command_update_driver_order(
        'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        1, gen_random_uuid(),
        '11111111-1111-1111-1111-111111111111'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid,
        'admin', '{"durationMinutes": 60}'::jsonb)$q$,
    'ORDER_NOT_FOUND',
    'another tenant cannot address this order'
  );
end
$$;
