-- Driver cancellation is intentionally narrow: only the assigned driver,
-- after acceptance, and before specialist pickup. It is also retry-safe.

\set ON_ERROR_STOP on
set client_min_messages = notice;

\set tenant '2ba8f6c8-aff9-4147-8f13-cdcb732de698'
\set order 'e0000000-0000-0000-0000-000000000004'

insert into public.driver_orders (
  id, restaurant_id, conversation_id, specialist_id, driver_id,
  arrival_at, customer_location, customer_phone, duration_minutes, trip_type
) values (
  :'order', :'tenant',
  'd0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  now() + interval '2 hours', 'حي الياسمين، الرياض', '+966555000001', 60, 'round_trip'
);

do $$
declare
  v_tenant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  v_order uuid := 'e0000000-0000-0000-0000-000000000004';
  v_driver_user uuid := '44444444-4444-4444-4444-444444444444';
  v_driver_acct uuid := 'f0000000-0000-0000-0000-000000000001';
  v_driver_roster uuid := 'c0000000-0000-0000-0000-000000000001';
  v_spec_user uuid := '55555555-5555-5555-5555-555555555555';
  v_spec_acct uuid := 'f0000000-0000-0000-0000-000000000002';
  v_key uuid := '77777777-7777-4777-8777-777777777777';
  v_ver bigint;
  v_response jsonb;
begin
  insert into public.field_order_progress (order_id, restaurant_id)
  values (v_order, v_tenant);

  perform kiara_test.raises(
    format($q$select public.kiara_command_cancel_accepted_driver_order(
      %L, %L, 1, gen_random_uuid(), %L, %L, %L, 'عطل في السيارة')$q$,
      v_tenant, v_order, v_driver_user, v_driver_acct, v_driver_roster),
    'FIELD_CANCEL_NOT_ALLOWED',
    'the driver cannot cancel before accepting the ride'
  );

  perform public.kiara_command_field_order_step(
    v_tenant, v_order, 1, gen_random_uuid(), v_driver_user, v_driver_acct,
    'driver', v_driver_roster, 'confirm_ride', null);
  select version into v_ver from public.field_order_progress where order_id = v_order;

  perform kiara_test.raises(
    format($q$select public.kiara_command_cancel_accepted_driver_order(
      %L, %L, %s, gen_random_uuid(), %L, %L, %L, 'عطل في السيارة')$q$,
      v_tenant, v_order, v_ver, v_spec_user, v_spec_acct, v_driver_roster),
    'FIELD_ACCOUNT_FORBIDDEN',
    'a specialist cannot cancel the accepted driver order'
  );

  v_response := public.kiara_command_cancel_accepted_driver_order(
    v_tenant, v_order, v_ver, v_key, v_driver_user, v_driver_acct,
    v_driver_roster, 'عطل في السيارة');
  perform kiara_test.ok(
    (select status = 'cancelled' and dispatch_state = 'cancelled'
       from public.driver_orders where id = v_order),
    'the accepted order is marked cancelled'
  );
  perform kiara_test.ok(
    (select payload->>'reason' = 'عطل في السيارة'
       from public.operation_events
      where aggregate_id = v_order and event_type = 'field.cancelled_by_driver'),
    'the driver reason is preserved in the audit event'
  );
  perform kiara_test.ok(
    (public.kiara_command_cancel_accepted_driver_order(
      v_tenant, v_order, v_ver, v_key, v_driver_user, v_driver_acct,
      v_driver_roster, 'عطل في السيارة')->>'replayed')::boolean,
    'a repeated cancellation replays the original result'
  );
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
      %L, %L, %s, gen_random_uuid(), %L, %L, 'specialist',
      'b0000000-0000-0000-0000-000000000001', 'confirm_pickup', null)$q$,
      v_tenant, v_order, v_ver + 1, v_spec_user, v_spec_acct),
    'FIELD_CANCEL_NOT_ALLOWED',
    'no field step can advance a cancelled order'
  );
end
$$;
