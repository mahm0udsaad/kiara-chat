-- An order's trip cost follows its district: choosing one prices the order,
-- changing it re-prices, clearing it clears the cost, and a return driver is
-- priced from the same district. Choosing a district is open to agents and
-- stays optional at dispatch.

\set ON_ERROR_STOP on
set client_min_messages = notice;

insert into public.districts (id, restaurant_id, name, trip_price, is_active) values
  ('d1000000-0000-0000-0000-000000000001', '2ba8f6c8-aff9-4147-8f13-cdcb732de698', 'حي الفهد', 25, true),
  ('d1000000-0000-0000-0000-000000000002', '2ba8f6c8-aff9-4147-8f13-cdcb732de698', 'القابل', 35, true),
  ('d1000000-0000-0000-0000-000000000003', '2ba8f6c8-aff9-4147-8f13-cdcb732de698', 'حي مؤرشف', 60, false),
  ('d1000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-00000000000a', 'حي تاجر آخر', 90, true);

insert into public.driver_orders (
  id, restaurant_id, conversation_id, specialist_id, driver_id,
  arrival_at, customer_location, customer_phone, duration_minutes,
  trip_type, price
) values
  ('e0000000-0000-0000-0000-000000000045',
   '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
   'd0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001',
   now() + interval '6 hours', 'حي الفهد، شارع ١', '+966555000001',
   60, 'one_way', 40),
  ('e0000000-0000-0000-0000-000000000046',
   '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
   'd0000000-0000-0000-0000-000000000002',
   null, null,
   now() + interval '7 hours', 'القابل، بجانب المسجد', '+966555000002',
   60, 'one_way', null),
  ('e0000000-0000-0000-0000-000000000047',
   '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
   'd0000000-0000-0000-0000-000000000002',
   null, null,
   now() + interval '8 hours', 'بدون حي', '+966555000002',
   60, 'one_way', null);

do $$
declare
  tenant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  v_order uuid := 'e0000000-0000-0000-0000-000000000045';
  agent_user uuid := '22222222-2222-2222-2222-222222222222';
  agent_tm uuid := 'a0000000-0000-0000-0000-000000000002';
  admin_user uuid := '11111111-1111-1111-1111-111111111111';
  admin_tm uuid := 'a0000000-0000-0000-0000-000000000001';
  ver bigint;
  v_row public.driver_orders%rowtype;
begin
  perform kiara_test.ok(
    (select price from public.driver_orders where id = v_order) = 40,
    'an order with no district keeps the price it was given'
  );

  -- An agent names the district; the fare follows without her touching price.
  select version into ver from public.driver_orders where id = v_order;
  perform public.kiara_command_update_driver_order(
    tenant, v_order, ver, gen_random_uuid(), agent_user, agent_tm, 'agent',
    jsonb_build_object('districtId', 'd1000000-0000-0000-0000-000000000001'));
  select * into v_row from public.driver_orders where id = v_order;
  perform kiara_test.ok(
    v_row.district_id = 'd1000000-0000-0000-0000-000000000001' and v_row.price = 25,
    'an agent may set the district and the order takes its fare'
  );
  perform kiara_test.ok(
    exists (select 1 from public.operation_events
      where aggregate_id = v_order and event_type = 'order.updated'
        and payload->'patch' ? 'districtId'),
    'the district change is audited'
  );

  -- An agent still cannot type a fare.
  perform kiara_test.raises(
    format($q$select public.kiara_command_update_driver_order(
      %L, %L, %s, gen_random_uuid(), %L, %L, 'agent', '{"price": 5}'::jsonb)$q$,
      tenant, v_order, v_row.version, agent_user, agent_tm),
    'ORDER_PRICE_FORBIDDEN',
    'an agent still cannot set the price directly'
  );

  -- Changing the district re-prices the order.
  perform public.kiara_command_update_driver_order(
    tenant, v_order, v_row.version, gen_random_uuid(), agent_user, agent_tm, 'agent',
    jsonb_build_object('districtId', 'd1000000-0000-0000-0000-000000000002'));
  select * into v_row from public.driver_orders where id = v_order;
  perform kiara_test.ok(v_row.price = 35, 'changing the district re-prices the order');

  -- Editing something else leaves the fare alone.
  perform public.kiara_command_update_driver_order(
    tenant, v_order, v_row.version, gen_random_uuid(), agent_user, agent_tm, 'agent',
    jsonb_build_object('durationMinutes', 90));
  select * into v_row from public.driver_orders where id = v_order;
  perform kiara_test.ok(v_row.price = 35, 'an unrelated edit keeps the district fare');

  -- A district price correction never rewrites a trip already priced.
  update public.districts set trip_price = 45
    where id = 'd1000000-0000-0000-0000-000000000002';
  perform kiara_test.ok(
    (select price from public.driver_orders where id = v_order) = 35,
    'the fare is a snapshot, not a live lookup'
  );

  -- A return driver is priced from the same district.
  perform public.kiara_command_update_driver_order(
    tenant, v_order, v_row.version, gen_random_uuid(), admin_user, admin_tm, 'admin',
    jsonb_build_object('returnDriverId', 'c0000000-0000-0000-0000-000000000002'));
  select * into v_row from public.driver_orders where id = v_order;
  perform kiara_test.ok(
    v_row.return_price = 45 and v_row.price = 35,
    'assigning a return driver prices the return leg from the district'
  );
  perform public.kiara_command_update_driver_order(
    tenant, v_order, v_row.version, gen_random_uuid(), admin_user, admin_tm, 'admin',
    jsonb_build_object('returnDriverId', null));
  select * into v_row from public.driver_orders where id = v_order;
  perform kiara_test.ok(v_row.return_price is null, 'removing the return driver drops its fare');

  -- Archived and foreign districts are refused.
  perform kiara_test.raises(
    format($q$select public.kiara_command_update_driver_order(
      %L, %L, %s, gen_random_uuid(), %L, %L, 'agent',
      '{"districtId": "d1000000-0000-0000-0000-000000000003"}'::jsonb)$q$,
      tenant, v_order, v_row.version, agent_user, agent_tm),
    'DISTRICT_NOT_AVAILABLE',
    'an archived district cannot be chosen'
  );
  perform kiara_test.raises(
    format($q$select public.kiara_command_update_driver_order(
      %L, %L, %s, gen_random_uuid(), %L, %L, 'agent',
      '{"districtId": "d1000000-0000-0000-0000-000000000004"}'::jsonb)$q$,
      tenant, v_order, v_row.version, agent_user, agent_tm),
    'DISTRICT_NOT_AVAILABLE',
    'another tenant''s district cannot be chosen'
  );

  -- Clearing the district puts the order back to "no cost yet".
  perform public.kiara_command_update_driver_order(
    tenant, v_order, v_row.version, gen_random_uuid(), agent_user, agent_tm, 'agent',
    jsonb_build_object('districtId', null));
  select * into v_row from public.driver_orders where id = v_order;
  perform kiara_test.ok(
    v_row.district_id is null and v_row.price is null,
    'clearing the district clears the trip cost'
  );

  -- A district in use cannot be hard-deleted (it would orphan the trip).
  perform public.kiara_command_update_driver_order(
    tenant, v_order, v_row.version, gen_random_uuid(), agent_user, agent_tm, 'agent',
    jsonb_build_object('districtId', 'd1000000-0000-0000-0000-000000000001'));
  perform kiara_test.raises(
    $q$delete from public.districts where id = 'd1000000-0000-0000-0000-000000000001'$q$,
    'foreign key',
    'a district used by an order cannot be deleted'
  );
end;
$$;

-- Dispatch: the district is optional and, when given, prices the order.
do $$
declare
  tenant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  with_district uuid := 'e0000000-0000-0000-0000-000000000046';
  without_district uuid := 'e0000000-0000-0000-0000-000000000047';
  v_result jsonb;
begin
  v_result := public.kiara_command_prepare_order_dispatch_v3(
    tenant, with_district,
    (select version from public.driver_orders where id = with_district),
    gen_random_uuid(),
    '33333333-3333-3333-3333-333333333333'::uuid,
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'agent',
    'b0000000-0000-0000-0000-000000000002'::uuid, null,
    'c0000000-0000-0000-0000-000000000002'::uuid,
    'one_way', null, 'القابل، بجانب المسجد',
    'موعد العميلة بعد الظهر', 'Appointment this afternoon', null,
    '+966500000012', '+966500000002', null, null,
    'd1000000-0000-0000-0000-000000000002'::uuid);
  perform kiara_test.ok(
    (select district_id = 'd1000000-0000-0000-0000-000000000002' and price = 45
      from public.driver_orders where id = with_district),
    'a district chosen at dispatch prices the order'
  );

  v_result := public.kiara_command_prepare_order_dispatch_v3(
    tenant, without_district,
    (select version from public.driver_orders where id = without_district),
    gen_random_uuid(),
    '33333333-3333-3333-3333-333333333333'::uuid,
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'agent',
    'b0000000-0000-0000-0000-000000000002'::uuid, null,
    'c0000000-0000-0000-0000-000000000001'::uuid,
    'one_way', null, 'بدون حي',
    'موعد العميلة مساءً', 'Appointment this evening', null,
    '+966500000011', '+966500000002', null, null,
    null);
  perform kiara_test.ok(
    (select district_id is null and price is null
      from public.driver_orders where id = without_district),
    'dispatch without a district goes out with no cost'
  );

  perform kiara_test.raises(
    format($q$select public.kiara_command_prepare_order_dispatch_v3(
      %L, %L, 1, gen_random_uuid(),
      '33333333-3333-3333-3333-333333333333', 'a0000000-0000-0000-0000-000000000003',
      'agent', 'b0000000-0000-0000-0000-000000000002', null,
      'c0000000-0000-0000-0000-000000000001', 'one_way', null, 'مكان',
      'ملاحظة السائق', 'note', null, null, null, null, null,
      'd1000000-0000-0000-0000-000000000003')$q$,
      tenant, without_district),
    'DISTRICT_NOT_AVAILABLE',
    'dispatch refuses an archived district'
  );

  perform kiara_test.ok(
    (select relrowsecurity from pg_class where oid = 'public.districts'::regclass)
      and not has_table_privilege('authenticated', 'public.districts', 'select')
      and not has_table_privilege('anon', 'public.districts', 'select'),
    'districts are server-only'
  );
  perform kiara_test.ok(
    not has_function_privilege('authenticated',
      'public.kiara_command_prepare_order_dispatch_v3(uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, text, text, text, text, text, uuid)',
      'execute'),
    'dispatch v3 is not callable by app users'
  );
end;
$$;
