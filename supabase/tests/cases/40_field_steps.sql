-- Matrix 7-10: role ownership, sequence enforcement and replay safety for
-- driver/specialist progression. A driver tapping twice on a bad connection
-- must not produce two events or two location checkpoints.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_key uuid := '0c000000-0000-0000-0000-000000000001';
  v_result jsonb;
  v_progress_version bigint;
begin
  -- Matrix 9: the second step cannot run before the first exists.
  perform kiara_test.raises(
    $q$select public.kiara_command_field_order_step(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000001'::uuid,
        1, gen_random_uuid(),
        '55555555-5555-5555-5555-555555555555'::uuid,
        'f0000000-0000-0000-0000-000000000002'::uuid,
        'specialist', 'b0000000-0000-0000-0000-000000000001'::uuid,
        'confirm_pickup', null)$q$,
    'FIELD_ACTION_OUT_OF_SEQUENCE',
    'pickup cannot precede the driver ride confirmation'
  );

  -- Matrix 7: a driver account cannot execute a specialist step...
  perform kiara_test.raises(
    $q$select public.kiara_command_field_order_step(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000001'::uuid,
        1, gen_random_uuid(),
        '44444444-4444-4444-4444-444444444444'::uuid,
        'f0000000-0000-0000-0000-000000000001'::uuid,
        'specialist', 'b0000000-0000-0000-0000-000000000001'::uuid,
        'confirm_pickup', null)$q$,
    'FIELD_ACCOUNT_FORBIDDEN',
    'a driver account cannot claim the specialist role'
  );

  -- ...and a specialist cannot execute the driver step.
  perform kiara_test.raises(
    $q$select public.kiara_command_field_order_step(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000001'::uuid,
        1, gen_random_uuid(),
        '55555555-5555-5555-5555-555555555555'::uuid,
        'f0000000-0000-0000-0000-000000000002'::uuid,
        'specialist', 'b0000000-0000-0000-0000-000000000001'::uuid,
        'confirm_ride', null)$q$,
    'FIELD_ACTION_FORBIDDEN',
    'a specialist cannot confirm the ride'
  );

  -- Another employee's session cannot act on this order.
  perform kiara_test.raises(
    $q$select public.kiara_command_field_order_step(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000001'::uuid,
        1, gen_random_uuid(),
        '66666666-6666-6666-6666-666666666666'::uuid,
        'f0000000-0000-0000-0000-000000000001'::uuid,
        'driver', 'c0000000-0000-0000-0000-000000000001'::uuid,
        'confirm_ride', null)$q$,
    'FIELD_ACCOUNT_FORBIDDEN',
    'a mismatched auth user cannot drive another account'
  );

  -- The assigned driver confirms, with location evidence.
  v_result := public.kiara_command_field_order_step(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
    'e0000000-0000-0000-0000-000000000001'::uuid,
    1, v_key,
    '44444444-4444-4444-4444-444444444444'::uuid,
    'f0000000-0000-0000-0000-000000000001'::uuid,
    'driver', 'c0000000-0000-0000-0000-000000000001'::uuid,
    'confirm_ride',
    jsonb_build_object(
      'latitude', 24.7136, 'longitude', 46.6753,
      'accuracyMeters', 12.5, 'capturedAt', now(),
      'source', 'device', 'permissionState', 'granted'
    )
  );
  perform kiara_test.ok(
    (v_result->>'replayed')::boolean is false, 'the ride confirmation commits');
  perform kiara_test.ok(
    (select driver_confirmed_at from public.field_order_progress
      where order_id = 'e0000000-0000-0000-0000-000000000001') is not null,
    'driver_confirmed_at is recorded'
  );
  perform kiara_test.ok(
    (select count(*) from public.field_location_checkpoints
      where order_id = 'e0000000-0000-0000-0000-000000000001') = 1,
    'one location checkpoint is stored'
  );

  -- Matrix 10: the same key replayed under a flaky connection.
  v_result := public.kiara_command_field_order_step(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
    'e0000000-0000-0000-0000-000000000001'::uuid,
    1, v_key,
    '44444444-4444-4444-4444-444444444444'::uuid,
    'f0000000-0000-0000-0000-000000000001'::uuid,
    'driver', 'c0000000-0000-0000-0000-000000000001'::uuid,
    'confirm_ride',
    jsonb_build_object(
      'latitude', 24.9, 'longitude', 46.9,
      'accuracyMeters', 30, 'capturedAt', now(),
      'source', 'device', 'permissionState', 'granted'
    )
  );
  perform kiara_test.ok(
    (v_result->>'replayed')::boolean is true, 'the repeated tap is a replay');
  perform kiara_test.ok(
    (select count(*) from public.field_location_checkpoints
      where order_id = 'e0000000-0000-0000-0000-000000000001') = 1,
    'a replay does not store a second checkpoint'
  );
  perform kiara_test.ok(
    (select count(*) from public.operation_events
      where aggregate_id = 'e0000000-0000-0000-0000-000000000001'
        and event_type = 'field.confirm_ride') = 1,
    'a replay does not append a second event'
  );

  -- The next step needs the new progress version.
  select version into v_progress_version from public.field_order_progress
    where order_id = 'e0000000-0000-0000-0000-000000000001';
  perform kiara_test.ok(v_progress_version = 2, 'progress version advanced');

  perform kiara_test.raises(
    $q$select public.kiara_command_field_order_step(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000001'::uuid,
        1, gen_random_uuid(),
        '55555555-5555-5555-5555-555555555555'::uuid,
        'f0000000-0000-0000-0000-000000000002'::uuid,
        'specialist', 'b0000000-0000-0000-0000-000000000001'::uuid,
        'confirm_pickup', null)$q$,
    'FIELD_VERSION_CONFLICT',
    'a stale progress version is rejected'
  );

  -- A manual location exception must carry a reason; an empty one is refused
  -- by the evidence constraint rather than stored as unexplained absence.
  perform kiara_test.raises(
    $q$select public.kiara_command_field_order_step(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
        'e0000000-0000-0000-0000-000000000001'::uuid,
        2, gen_random_uuid(),
        '55555555-5555-5555-5555-555555555555'::uuid,
        'f0000000-0000-0000-0000-000000000002'::uuid,
        'specialist', 'b0000000-0000-0000-0000-000000000001'::uuid,
        'confirm_pickup',
        '{"source": "manual_exception"}'::jsonb)$q$,
    'field_location_checkpoint_evidence_check',
    'a manual exception without a reason is rejected'
  );

  v_result := public.kiara_command_field_order_step(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
    'e0000000-0000-0000-0000-000000000001'::uuid,
    2, gen_random_uuid(),
    '55555555-5555-5555-5555-555555555555'::uuid,
    'f0000000-0000-0000-0000-000000000002'::uuid,
    'specialist', 'b0000000-0000-0000-0000-000000000001'::uuid,
    'confirm_pickup',
    '{"source": "manual_exception", "exceptionReason": "الموقع غير متاح داخل المبنى",
      "permissionState": "denied"}'::jsonb
  );
  perform kiara_test.ok(
    (select specialist_pickup_at from public.field_order_progress
      where order_id = 'e0000000-0000-0000-0000-000000000001') is not null,
    'a documented exception still advances the step'
  );
  perform kiara_test.ok(
    (select count(*) from public.field_location_checkpoints
      where order_id = 'e0000000-0000-0000-0000-000000000001'
        and source = 'manual_exception') = 1,
    'the exception is stored as evidence for the owner report'
  );
end
$$;
