-- Matrix 4-6: dispatch reservation, outbox claim exclusivity and completion
-- replay. The business risk being tested is a duplicate WhatsApp message to a
-- driver, so "only one caller may claim" is the assertion that matters most.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_cmd uuid := '0b000000-0000-0000-0000-000000000001';
  v_result jsonb;
  v_driver_outbox uuid;
  v_specialist_outbox uuid;
  v_claim jsonb;
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
    '+966500000012', 'موعد العميلة الساعة 5 مساءً في حي الملقا',
    '+966500000002', 'Appointment at 5pm, Al Malqa district'
  );

  v_driver_outbox := (v_result->>'driverOutboxId')::uuid;
  v_specialist_outbox := (v_result->>'specialistOutboxId')::uuid;

  perform kiara_test.ok(v_driver_outbox is not null, 'a driver outbox event is queued');
  perform kiara_test.ok(v_specialist_outbox is not null, 'a specialist outbox event is queued');
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
  -- The message stored is exactly what the employee confirmed. Anything else
  -- would mean the confirmation sheet is decorative.
  perform kiara_test.ok(
    (select payload->>'body' from public.outbox_events where id = v_driver_outbox)
      = 'موعد العميلة الساعة 5 مساءً في حي الملقا',
    'the outbox stores the exact confirmed driver text'
  );
  perform kiara_test.ok(
    (select status from public.outbox_events where id = v_driver_outbox) = 'pending',
    'the driver event starts pending'
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
        'one_way', 450, '+966500000012', 'رسالة ثانية',
        '+966500000002', 'second message')$q$,
    'ORDER_DISPATCH_IN_PROGRESS',
    'a second employee cannot dispatch an order already dispatching'
  );

  -- Matrix 5: repeated claims; exactly one returns claimed=true.
  v_claim := public.kiara_claim_outbox_event(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid, v_cmd, v_driver_outbox);
  perform kiara_test.ok(
    (v_claim->>'claimed')::boolean is true, 'the first claim wins');

  v_claim := public.kiara_claim_outbox_event(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid, v_cmd, v_driver_outbox);
  perform kiara_test.ok(
    (v_claim->>'claimed')::boolean is false, 'the second claim is refused');
  perform kiara_test.ok(
    (select attempt_count from public.outbox_events where id = v_driver_outbox) = 1,
    'a refused claim does not inflate attempt_count'
  );

  v_claim := public.kiara_claim_outbox_event(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid, v_cmd, v_specialist_outbox);
  perform kiara_test.ok(
    (v_claim->>'claimed')::boolean is true, 'the specialist event claims independently');

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
    (select count(*) from public.outbox_events
      where command_id = v_cmd and status = 'sent') = 2,
    'both outbox events settle as sent'
  );

  -- Matrix 6: completion replay returns the original result, does not re-send.
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
        'one_way', 450, '+966500000012', 'رسالة مكررة',
        '+966500000002', 'duplicate')$q$,
    'ORDER_ALREADY_DISPATCHED',
    'a sent order cannot be dispatched twice'
  );
end
$$;
