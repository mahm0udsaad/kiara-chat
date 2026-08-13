-- The durable Rekaz -> order link.
--
-- Two employees can tap `طلب سائق` on the same visit at the same moment. The
-- partial unique index is the barrier that turns that into one order, and it
-- must not interfere with the many orders that have no Rekaz origin at all.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_new_order uuid;
begin
  perform kiara_test.ok(
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'driver_orders'
        and column_name = 'rekaz_source_id'
    ),
    'driver_orders carries rekaz_source_id'
  );

  insert into public.driver_orders (
    restaurant_id, conversation_id, arrival_at, customer_location,
    customer_phone, duration_minutes, rekaz_source_id
  ) values (
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
    'd0000000-0000-0000-0000-000000000001',
    now() + interval '1 day', 'حي النرجس', '+966555000001', 90, 'R1'
  ) returning id into v_new_order;
  perform kiara_test.ok(v_new_order is not null, 'a visit can be linked to an order');

  perform kiara_test.raises(
    $q$insert into public.driver_orders (
         restaurant_id, conversation_id, arrival_at, customer_location,
         customer_phone, duration_minutes, rekaz_source_id
       ) values (
         '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
         'd0000000-0000-0000-0000-000000000001',
         now() + interval '1 day', 'حي النرجس', '+966555000001', 90, 'R1')$q$,
    'driver_orders_rekaz_source_key',
    'a second order cannot claim the same reservation'
  );

  -- Conversation-born orders keep no link, and many of them coexist.
  insert into public.driver_orders (
    restaurant_id, conversation_id, arrival_at, customer_location,
    customer_phone, duration_minutes
  ) values
    ('2ba8f6c8-aff9-4147-8f13-cdcb732de698',
     'd0000000-0000-0000-0000-000000000001',
     now() + interval '2 days', 'حي الملقا', '+966555000001', 60),
    ('2ba8f6c8-aff9-4147-8f13-cdcb732de698',
     'd0000000-0000-0000-0000-000000000002',
     now() + interval '3 days', 'حي الياسمين', '+966555000002', 60);
  perform kiara_test.ok(
    (select count(*) from public.driver_orders where rekaz_source_id is null) >= 2,
    'unlinked orders are unaffected by the unique index'
  );

  -- The same reservation id under another tenant is a different reservation.
  insert into public.profiles (id, email)
    values ('88888888-8888-8888-8888-888888888888', 'second@example.test');
  insert into public.conversations (id, restaurant_id, customer_phone)
    values ('d0000000-0000-0000-0000-0000000000ff',
            'aaaaaaaa-0000-0000-0000-00000000000a', '+966555000003');
  insert into public.driver_orders (
    restaurant_id, conversation_id, arrival_at, customer_location,
    customer_phone, duration_minutes, rekaz_source_id
  ) values (
    'aaaaaaaa-0000-0000-0000-00000000000a',
    'd0000000-0000-0000-0000-0000000000ff',
    now() + interval '1 day', 'Other tenant', '+966555000003', 60, 'R1'
  );
  perform kiara_test.ok(
    (select count(*) from public.driver_orders where rekaz_source_id = 'R1') = 2,
    'the link is scoped per tenant'
  );
end
$$;
