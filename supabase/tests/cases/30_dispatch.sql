-- Matrix 4-6: dispatch reservation, note persistence and completion replay.
--
-- Dispatch is app-only: the command stores the two notes on the order and
-- queues nothing. The business risk being tested is therefore no longer a
-- duplicate WhatsApp message but a lost or overwritten hand-off — an order the
-- field team can see without the instructions that came with it, or a second
-- employee reserving an order that is already being dispatched.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_cmd uuid := '0b000000-0000-0000-0000-000000000001';
  v_result jsonb;
  v_order public.driver_orders%rowtype;
begin
  select * into v_order from public.driver_orders
    where id = 'e0000000-0000-0000-0000-000000000002';

  v_result := public.kiara_command_prepare_order_dispatch(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
    'e0000000-0000-0000-0000-000000000002'::uuid,
    v_order.version, v_cmd,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'admin',
    'b0000000-0000-0000-0000-000000000002'::uuid,
    'c0000000-0000-0000-0000-000000000002'::uuid,
    'round_trip', 450,
    'موعد العميلة الساعة 5 مساءً في حي الملقا',
    'Appointment at 5pm, Al Malqa district',
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698/conv/2026/09/note.m4a'
  );

  perform kiara_test.ok(
    (select dispatch_state from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000002') = 'processing',
    'the order moves to dispatch_state=processing'
  );
  perform kiara_test.ok(
    (select active_dispatch_command_id from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000002') = v_cmd,
    'the order reserves the dispatch command id'
  );

  -- The note stored is exactly what the employee confirmed. Anything else
  -- would mean the confirmation sheet is decorative.
  perform kiara_test.ok(
    (select driver_note from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000002')
      = 'موعد العميلة الساعة 5 مساءً في حي الملقا',
    'the order stores the exact confirmed driver note'
  );
  perform kiara_test.ok(
    (select specialist_note from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000002')
      = 'Appointment at 5pm, Al Malqa district',
    'the order stores the exact confirmed specialist note'
  );
  perform kiara_test.ok(
    (select specialist_voice_path from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000002')
      = '2ba8f6c8-aff9-4147-8f13-cdcb732de698/conv/2026/09/note.m4a',
    'the recorded note is stored as a bucket path'
  );

  -- Nothing is addressed at a phone any more.
  perform kiara_test.ok(
    (select count(*) from public.outbox_events where command_id = v_cmd) = 0,
    'an app-only dispatch queues no outbox events'
  );

  -- Matrix 4: a second dispatch cannot reserve the same order.
  perform kiara_test.raises(
    $q$select public.kiara_command_prepare_order_dispatch(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        (select version from public.driver_orders
           where id = 'e0000000-0000-0000-0000-000000000002'),
        gen_random_uuid(),
        '33333333-3333-3333-3333-333333333333'::uuid,
        'a0000000-0000-0000-0000-000000000003'::uuid,
        'agent',
        'b0000000-0000-0000-0000-000000000002'::uuid,
        'c0000000-0000-0000-0000-000000000002'::uuid,
        'one_way', 450, 'ملاحظة ثانية', 'second note', null)$q$,
    'ORDER_DISPATCH_IN_PROGRESS',
    'a second employee cannot dispatch an order already dispatching'
  );

  -- A note is the whole hand-off, so an empty one is not a dispatch.
  perform kiara_test.raises(
    $q$select public.kiara_command_prepare_order_dispatch(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000001'::uuid,
        (select version from public.driver_orders
           where id = 'e0000000-0000-0000-0000-000000000001'),
        gen_random_uuid(),
        '11111111-1111-1111-1111-111111111111'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid,
        'admin',
        'b0000000-0000-0000-0000-000000000001'::uuid,
        'c0000000-0000-0000-0000-000000000001'::uuid,
        'one_way', 350, '  ', 'specialist note', null)$q$,
    'DRIVER_MESSAGE_INVALID',
    'a blank driver note is refused'
  );

  -- Completion.
  v_result := public.kiara_command_finish_order_dispatch(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
    'e0000000-0000-0000-0000-000000000002'::uuid,
    v_cmd, true, true, null, null
  );
  perform kiara_test.ok(
    (v_result->>'replayed')::boolean is false, 'completion is not a replay');
  perform kiara_test.ok(
    (select status from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000002') = 'sent',
    'the order is marked sent'
  );
  perform kiara_test.ok(
    (select active_dispatch_command_id from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000002') is null,
    'the dispatch reservation is released'
  );
  perform kiara_test.ok(
    (select driver_note from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000002')
      = 'موعد العميلة الساعة 5 مساءً في حي الملقا',
    'completion leaves the stored notes untouched'
  );

  -- Matrix 6: completion replay returns the original result, changes nothing.
  v_result := public.kiara_command_finish_order_dispatch(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
    'e0000000-0000-0000-0000-000000000002'::uuid,
    v_cmd, false, false, 'network', 'network'
  );
  perform kiara_test.ok(
    (v_result->>'replayed')::boolean is true, 'completion replay is detected');
  perform kiara_test.ok(
    (select status from public.driver_orders
      where id = 'e0000000-0000-0000-0000-000000000002') = 'sent',
    'a completion replay does not downgrade the order to failed'
  );
  perform kiara_test.ok(
    (select count(*) from public.operation_events
      where aggregate_id = 'e0000000-0000-0000-0000-000000000002'
        and event_type = 'order.dispatch_completed') = 1,
    'a completion replay appends no second audit event'
  );

  -- An order already sent cannot be dispatched again.
  perform kiara_test.raises(
    $q$select public.kiara_command_prepare_order_dispatch(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000002'::uuid,
        (select version from public.driver_orders
           where id = 'e0000000-0000-0000-0000-000000000002'),
        gen_random_uuid(),
        '11111111-1111-1111-1111-111111111111'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid,
        'admin',
        'b0000000-0000-0000-0000-000000000002'::uuid,
        'c0000000-0000-0000-0000-000000000002'::uuid,
        'one_way', 450, 'ملاحظة مكررة', 'duplicate', null)$q$,
    'ORDER_ALREADY_DISPATCHED',
    'a sent order cannot be dispatched twice'
  );
end
$$;
