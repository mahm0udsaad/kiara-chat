-- The driver "I've arrived" side ping and the driver return-trip close-out
-- added in 20260824120000. Runs on its own order so the arrival ping is
-- exercised while specialist_pickup_at is still null.
--
-- Invariants proven here:
--   * driver_arrived gates specialist pickup.
--   * driver_client_arrived is driver-only, follows pickup, and gates service.
--   * driver_return is the new terminal step: driver-only, and only after the
--     specialist has finished the service.

\set ON_ERROR_STOP on
set client_min_messages = notice;

\set tenant '2ba8f6c8-aff9-4147-8f13-cdcb732de698'
\set order 'e0000000-0000-0000-0000-000000000003'

insert into public.driver_orders (
  id, restaurant_id, conversation_id, specialist_id, driver_id,
  arrival_at, customer_location, customer_phone, duration_minutes, trip_type
) values (
  :'order', :'tenant',
  'd0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
  now() + interval '2 hours', 'حي الياسمين، الرياض', '+966555000001', 60, 'round_trip'
);

do $$
declare
  v_tenant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  v_order uuid := 'e0000000-0000-0000-0000-000000000003';
  v_driver_user uuid := '44444444-4444-4444-4444-444444444444';
  v_driver_acct uuid := 'f0000000-0000-0000-0000-000000000001';
  v_driver_roster uuid := 'c0000000-0000-0000-0000-000000000001';
  v_spec_user uuid := '55555555-5555-5555-5555-555555555555';
  v_spec_acct uuid := 'f0000000-0000-0000-0000-000000000002';
  v_spec_roster uuid := 'b0000000-0000-0000-0000-000000000001';
  v_ver bigint;
begin
  -- The arrival ping cannot precede the ride: with no progress row yet, the
  -- driver has not confirmed departure.
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
        %L, %L, 1, gen_random_uuid(), %L, %L, 'driver', %L, 'driver_arrived', null)$q$,
      v_tenant, v_order, v_driver_user, v_driver_acct, v_driver_roster),
    'FIELD_ACTION_OUT_OF_SEQUENCE',
    'arrival at the specialist cannot precede the ride confirmation'
  );

  -- Driver confirms departure.
  perform public.kiara_command_field_order_step(
    v_tenant, v_order, 1, gen_random_uuid(), v_driver_user, v_driver_acct,
    'driver', v_driver_roster, 'confirm_ride', null);

  select version into v_ver from public.field_order_progress where order_id = v_order;

  -- A specialist may not fire the driver's arrival ping.
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
        %L, %L, %s, gen_random_uuid(), %L, %L, 'specialist', %L, 'driver_arrived', null)$q$,
      v_tenant, v_order, v_ver, v_spec_user, v_spec_acct, v_spec_roster),
    'FIELD_ACTION_FORBIDDEN',
    'a specialist cannot fire the driver arrival ping'
  );

  -- The driver announces he reached the specialist.
  perform public.kiara_command_field_order_step(
    v_tenant, v_order, v_ver, gen_random_uuid(), v_driver_user, v_driver_acct,
    'driver', v_driver_roster, 'driver_arrived', null);
  perform kiara_test.ok(
    (select driver_arrived_at from public.field_order_progress where order_id = v_order) is not null,
    'driver_arrived_at is recorded'
  );
  perform kiara_test.ok(
    (select specialist_pickup_at from public.field_order_progress where order_id = v_order) is null,
    'driver arrival does not impersonate the specialist pickup'
  );

  -- The specialist can confirm pickup after the driver arrives.
  select version into v_ver from public.field_order_progress where order_id = v_order;
  perform public.kiara_command_field_order_step(
    v_tenant, v_order, v_ver, gen_random_uuid(), v_spec_user, v_spec_acct,
    'specialist', v_spec_roster, 'confirm_pickup', null);

  -- Once she is in the car the arrival ping is no longer meaningful.
  select version into v_ver from public.field_order_progress where order_id = v_order;
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
        %L, %L, %s, gen_random_uuid(), %L, %L, 'driver', %L, 'driver_arrived', null)$q$,
      v_tenant, v_order, v_ver, v_driver_user, v_driver_acct, v_driver_roster),
    'FIELD_ACTION_OUT_OF_SEQUENCE',
    'the arrival ping is refused once the specialist is picked up'
  );

  -- The new client-arrival checkpoint belongs to the driver.
  select version into v_ver from public.field_order_progress where order_id = v_order;
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
        %L, %L, %s, gen_random_uuid(), %L, %L, 'specialist', %L, 'driver_client_arrived', null)$q$,
      v_tenant, v_order, v_ver, v_spec_user, v_spec_acct, v_spec_roster),
    'FIELD_ACTION_FORBIDDEN',
    'a specialist cannot confirm driver arrival at the customer'
  );
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
        %L, %L, %s, gen_random_uuid(), %L, %L, 'specialist', %L, 'start_service', null)$q$,
      v_tenant, v_order, v_ver, v_spec_user, v_spec_acct, v_spec_roster),
    'FIELD_ACTION_OUT_OF_SEQUENCE',
    'service cannot start before the driver confirms customer arrival'
  );
  perform public.kiara_command_field_order_step(
    v_tenant, v_order, v_ver, gen_random_uuid(), v_driver_user, v_driver_acct,
    'driver', v_driver_roster, 'driver_client_arrived', null);
  perform kiara_test.ok(
    (select driver_client_arrived_at from public.field_order_progress where order_id = v_order) is not null,
    'driver_client_arrived_at is recorded'
  );

  select version into v_ver from public.field_order_progress where order_id = v_order;
  perform public.kiara_command_field_order_step(
    v_tenant, v_order, v_ver, gen_random_uuid(), v_spec_user, v_spec_acct,
    'specialist', v_spec_roster, 'start_service', null);

  -- The driver cannot close out before the service is finished.
  select version into v_ver from public.field_order_progress where order_id = v_order;
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
        %L, %L, %s, gen_random_uuid(), %L, %L, 'driver', %L, 'driver_return', null)$q$,
      v_tenant, v_order, v_ver, v_driver_user, v_driver_acct, v_driver_roster),
    'FIELD_ACTION_OUT_OF_SEQUENCE',
    'the return step cannot precede the service completion'
  );

  -- The specialist finishes the service (this is what resolves CS today).
  perform public.kiara_command_field_order_step(
    v_tenant, v_order, v_ver, gen_random_uuid(), v_spec_user, v_spec_acct,
    'specialist', v_spec_roster, 'complete_order', null);
  perform kiara_test.ok(
    (select completed_at from public.field_order_progress where order_id = v_order) is not null,
    'the service completion is recorded'
  );

  -- The closing step belongs to the driver, not the specialist.
  select version into v_ver from public.field_order_progress where order_id = v_order;
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
        %L, %L, %s, gen_random_uuid(), %L, %L, 'specialist', %L, 'driver_return', null)$q$,
      v_tenant, v_order, v_ver, v_spec_user, v_spec_acct, v_spec_roster),
    'FIELD_ACTION_FORBIDDEN',
    'a specialist cannot close out the driver return trip'
  );

  -- The driver confirms the return trip: the visit is now fully done.
  perform public.kiara_command_field_order_step(
    v_tenant, v_order, v_ver, gen_random_uuid(), v_driver_user, v_driver_acct,
    'driver', v_driver_roster, 'driver_return', null);
  perform kiara_test.ok(
    (select driver_returned_at from public.field_order_progress where order_id = v_order) is not null,
    'driver_returned_at is recorded'
  );

  -- Nothing remains: any further step is out of sequence.
  select version into v_ver from public.field_order_progress where order_id = v_order;
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
        %L, %L, %s, gen_random_uuid(), %L, %L, 'driver', %L, 'driver_return', null)$q$,
      v_tenant, v_order, v_ver, v_driver_user, v_driver_acct, v_driver_roster),
    'FIELD_ACTION_OUT_OF_SEQUENCE',
    'a fully-returned order accepts no further steps'
  );

end
$$;
