-- A one-way outbound leg may hand the specialist's later pickup to a second
-- driver. The second driver can see the order but owns only its final action.

\set ON_ERROR_STOP on
set client_min_messages = notice;

insert into public.driver_orders (
  id, restaurant_id, conversation_id, specialist_id, driver_id,
  return_driver_id, arrival_at, customer_location, customer_phone,
  duration_minutes, trip_type, price, return_price
) values (
  'e0000000-0000-0000-0000-000000000005',
  '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
  'd0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000002',
  now() + interval '4 hours', 'حي النرجس، الرياض', '+966555000001',
  60, 'one_way', 25, 35
);

do $$
declare
  tenant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  v_order uuid := 'e0000000-0000-0000-0000-000000000005';
  outbound_user uuid := '44444444-4444-4444-4444-444444444444';
  outbound_account uuid := 'f0000000-0000-0000-0000-000000000001';
  outbound_driver uuid := 'c0000000-0000-0000-0000-000000000001';
  return_user uuid := '77777777-7777-4777-8777-777777777777';
  return_account uuid := 'f0000000-0000-0000-0000-000000000003';
  return_driver uuid := 'c0000000-0000-0000-0000-000000000002';
  specialist_user uuid := '55555555-5555-5555-5555-555555555555';
  specialist_account uuid := 'f0000000-0000-0000-0000-000000000002';
  specialist uuid := 'b0000000-0000-0000-0000-000000000001';
  ver bigint := 1;
begin
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
      %L,%L,1,gen_random_uuid(),%L,%L,'driver',%L,'confirm_ride',null)$q$,
      tenant, v_order, return_user, return_account, return_driver),
    'FIELD_ACTION_FORBIDDEN',
    'the return driver cannot perform an outbound action'
  );

  perform public.kiara_command_field_order_step(
    tenant, v_order, ver, gen_random_uuid(), outbound_user, outbound_account,
    'driver', outbound_driver, 'confirm_ride', null);
  select version into ver from public.field_order_progress where order_id = v_order;
  perform public.kiara_command_field_order_step(
    tenant, v_order, ver, gen_random_uuid(), outbound_user, outbound_account,
    'driver', outbound_driver, 'driver_arrived', null);
  select version into ver from public.field_order_progress where order_id = v_order;
  perform public.kiara_command_field_order_step(
    tenant, v_order, ver, gen_random_uuid(), specialist_user, specialist_account,
    'specialist', specialist, 'confirm_pickup', null);
  select version into ver from public.field_order_progress where order_id = v_order;
  perform public.kiara_command_field_order_step(
    tenant, v_order, ver, gen_random_uuid(), outbound_user, outbound_account,
    'driver', outbound_driver, 'driver_client_arrived', null);
  select version into ver from public.field_order_progress where order_id = v_order;
  perform public.kiara_command_field_order_step(
    tenant, v_order, ver, gen_random_uuid(), specialist_user, specialist_account,
    'specialist', specialist, 'start_service', null);
  select version into ver from public.field_order_progress where order_id = v_order;
  perform public.kiara_command_field_order_step(
    tenant, v_order, ver, gen_random_uuid(), specialist_user, specialist_account,
    'specialist', specialist, 'complete_order', null);

  perform kiara_test.ok(
    (select driver_client_arrived_at is not null and driver_returned_at is null
      from public.field_order_progress where order_id = v_order),
    'the outbound driver finishes at the customer while return remains open'
  );

  select version into ver from public.field_order_progress where order_id = v_order;
  perform kiara_test.raises(
    format($q$select public.kiara_command_field_order_step(
      %L,%L,%s,gen_random_uuid(),%L,%L,'driver',%L,'driver_return',null)$q$,
      tenant, v_order, ver, outbound_user, outbound_account, outbound_driver),
    'FIELD_ACTION_FORBIDDEN',
    'the outbound driver cannot close the assigned return leg'
  );

  perform public.kiara_command_field_order_step(
    tenant, v_order, ver, gen_random_uuid(), return_user, return_account,
    'driver', return_driver, 'driver_return', null);
  perform kiara_test.ok(
    (select driver_returned_at is not null
      from public.field_order_progress where order_id = v_order),
    'the return driver closes the visit with the only action they own'
  );
  perform kiara_test.ok(
    (select price = 25 and return_price = 35
      from public.driver_orders where id = v_order),
    'outbound and return fares remain independent'
  );
end
$$;
