-- Matrix 12-14: repeat snapshots produce unchanged counts, a disappearance is
-- recorded once, and a reappearance is a restore.
--
-- The removal case is the dangerous one. `fetchRekazReservations()` returns a
-- ROLLING window (yesterday .. +60 days), so anything the apply treats as
-- "absent from the snapshot" must be judged inside that same window or every
-- sync silently retires the previous day's history.

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function kiara_test.rekaz_row(
  p_source_id text,
  p_arrival timestamptz,
  p_hash text
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'sourceId', p_source_id,
    'sourceOrderId', 'order-' || p_source_id,
    'payloadHash', p_hash,
    'arrivalAt', p_arrival,
    'customerPhone', '+966555000001',
    'customerName', 'عميلة ركاز',
    'status', 'Confirmed',
    'payload', jsonb_build_object('id', p_source_id, 'hash', p_hash)
  );
$$;

-- The same window the adapter uses: DAYS_BACK = 1, DAYS_AHEAD = 60.
create or replace function kiara_test.rekaz_apply(p_run uuid, p_rows jsonb)
returns jsonb
language sql
as $$
  select public.kiara_apply_rekaz_snapshot(
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid,
    p_run,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid,
    p_rows,
    date_trunc('day', now()) - interval '1 day',
    date_trunc('day', now()) + interval '61 days',
    'admin'
  );
$$;

do $$
declare
  v_run1 uuid := '0d000000-0000-0000-0000-000000000001';
  v_run2 uuid := '0d000000-0000-0000-0000-000000000002';
  v_run3 uuid := '0d000000-0000-0000-0000-000000000003';
  v_result jsonb;
  v_today timestamptz := date_trunc('day', now());
begin
  -- Run 1: two brand-new reservations.
  v_result := kiara_test.rekaz_apply(v_run1, jsonb_build_array(
    kiara_test.rekaz_row('R1', v_today + interval '10 hours', 'hash-1'),
    kiara_test.rekaz_row('R2', v_today + interval '2 days', 'hash-2')
  ));
  perform kiara_test.ok((v_result->>'added')::int = 2, 'run 1 reports 2 added');
  perform kiara_test.ok((v_result->>'removed')::int = 0, 'run 1 reports 0 removed');

  -- Matrix 12: the identical snapshot again is entirely unchanged.
  v_result := kiara_test.rekaz_apply(v_run2, jsonb_build_array(
    kiara_test.rekaz_row('R1', v_today + interval '10 hours', 'hash-1'),
    kiara_test.rekaz_row('R2', v_today + interval '2 days', 'hash-2')
  ));
  perform kiara_test.ok((v_result->>'added')::int = 0, 'run 2 adds nothing');
  perform kiara_test.ok((v_result->>'updated')::int = 0, 'run 2 updates nothing');
  perform kiara_test.ok((v_result->>'unchanged')::int = 2, 'run 2 reports 2 unchanged');
  perform kiara_test.ok((v_result->>'removed')::int = 0, 'run 2 removes nothing');

  -- Matrix 13: R2 disappears from the feed once.
  v_result := kiara_test.rekaz_apply(v_run3, jsonb_build_array(
    kiara_test.rekaz_row('R1', v_today + interval '10 hours', 'hash-1')
  ));
  perform kiara_test.ok((v_result->>'removed')::int = 1, 'a disappearance is one removal');
  perform kiara_test.ok(
    (select removed_at from public.rekaz_reservations where source_id = 'R2') is not null,
    'the removed reservation is tombstoned, not deleted'
  );

  -- Removing it again must not re-report it.
  v_result := kiara_test.rekaz_apply(gen_random_uuid(), jsonb_build_array(
    kiara_test.rekaz_row('R1', v_today + interval '10 hours', 'hash-1')
  ));
  perform kiara_test.ok(
    (v_result->>'removed')::int = 0,
    'an already-removed reservation is not removed twice'
  );

  -- Matrix 14: R2 comes back.
  v_result := kiara_test.rekaz_apply(gen_random_uuid(), jsonb_build_array(
    kiara_test.rekaz_row('R1', v_today + interval '10 hours', 'hash-1'),
    kiara_test.rekaz_row('R2', v_today + interval '2 days', 'hash-2')
  ));
  perform kiara_test.ok((v_result->>'updated')::int = 1, 'the return is counted as a change');
  perform kiara_test.ok(
    (select removed_at from public.rekaz_reservations where source_id = 'R2') is null,
    'the restored reservation is live again'
  );
  perform kiara_test.ok(
    exists (select 1 from public.rekaz_changes
      where source_id = 'R2' and change_type = 'restored'),
    'the restore is recorded as its own change type'
  );

  -- A snapshot replay under the same run id returns the original counts.
  v_result := kiara_test.rekaz_apply(v_run1, jsonb_build_array(
    kiara_test.rekaz_row('R1', v_today + interval '10 hours', 'hash-1')
  ));
  perform kiara_test.ok(
    (v_result->>'replayed')::boolean is true and (v_result->>'added')::int = 2,
    'replaying a completed sync run returns its original counts'
  );

  -- A cancelled booking is a status change, not a disappearance: it must land
  -- as an update so the pending banner never reports a phantom removal.
  v_result := kiara_test.rekaz_apply(gen_random_uuid(), jsonb_build_array(
    kiara_test.rekaz_row('R1', v_today + interval '10 hours', 'hash-1'),
    jsonb_build_object(
      'sourceId', 'R2', 'sourceOrderId', 'order-R2', 'payloadHash', 'hash-2-cancelled',
      'arrivalAt', v_today + interval '2 days',
      'customerPhone', '+966555000001', 'customerName', 'عميلة ركاز',
      'status', 'Cancelled', 'payload', '{"id": "R2", "status": "Cancelled"}'::jsonb)
  ));
  perform kiara_test.ok(
    (v_result->>'removed')::int = 0 and (v_result->>'updated')::int = 1,
    'a cancellation is an update, not a removal'
  );
  perform kiara_test.ok(
    (select status from public.rekaz_reservations where source_id = 'R2') = 'Cancelled',
    'the cancelled status is retained for the calendar to filter'
  );
end
$$;

-- Input validation, including the new window guards.
do $$
declare
  v_today timestamptz := date_trunc('day', now());
begin
  perform kiara_test.raises(
    $q$select kiara_test.rekaz_apply(gen_random_uuid(),
        jsonb_build_array(jsonb_build_object('sourceId', 'R9', 'payloadHash', 'h',
          'arrivalAt', null, 'payload', '{}'::jsonb)))$q$,
    'REKAZ_ROW_INVALID',
    'a row without an arrival time is refused'
  );
  perform kiara_test.raises(
    $q$select kiara_test.rekaz_apply(gen_random_uuid(),
        jsonb_build_array(
          kiara_test.rekaz_row('DUP', now(), 'a'),
          kiara_test.rekaz_row('DUP', now(), 'b')))$q$,
    'REKAZ_SOURCE_ID_DUPLICATE',
    'a duplicated source id is refused'
  );
  perform kiara_test.raises(
    $q$select public.kiara_apply_rekaz_snapshot(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid, gen_random_uuid(),
        null, null, '[]'::jsonb, null, null)$q$,
    'REKAZ_WINDOW_INVALID',
    'an apply without a window is refused'
  );
  -- A payload that reaches outside its declared window means the caller and
  -- the command disagree about scope; removals could not be trusted.
  perform kiara_test.raises(
    format($q$select public.kiara_apply_rekaz_snapshot(
        '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid, gen_random_uuid(),
        null, null,
        jsonb_build_array(kiara_test.rekaz_row('FAR', '%s'::timestamptz, 'h')),
        '%s'::timestamptz, '%s'::timestamptz)$q$,
      v_today + interval '400 days', v_today - interval '1 day',
      v_today + interval '61 days'),
    'REKAZ_ROW_OUTSIDE_WINDOW',
    'a row beyond the declared window is refused'
  );
end
$$;

-- The rolling-window hazard, stated as an executable expectation.
--
-- Yesterday's reservation is outside tomorrow's fetch window, so it is absent
-- from the next snapshot for a completely innocent reason. It must NOT be
-- reported as a Rekaz removal: doing so invents cancellations in the pending
-- banner and in the change history the owner reports are built from.
do $$
declare
  v_result jsonb;
  v_today timestamptz := date_trunc('day', now());
begin
  insert into public.rekaz_reservations (
    restaurant_id, source_id, payload_hash, arrival_at,
    customer_phone, customer_name, status, payload
  ) values (
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid, 'OLD-1', 'hash-old',
    v_today - interval '9 days', '+966555000009', 'عميلة قديمة', 'Confirmed',
    '{"id": "OLD-1"}'::jsonb
  );

  v_result := kiara_test.rekaz_apply(gen_random_uuid(), jsonb_build_array(
    kiara_test.rekaz_row('R1', v_today + interval '10 hours', 'hash-1'),
    kiara_test.rekaz_row('R2', v_today + interval '2 days', 'hash-2')
  ));

  perform kiara_test.ok(
    (v_result->>'removed')::int = 0,
    'a reservation older than the fetch window is not reported as removed'
  );
  perform kiara_test.ok(
    (select removed_at from public.rekaz_reservations where source_id = 'OLD-1') is null,
    'a reservation older than the fetch window keeps its history'
  );

  -- ...while a disappearance INSIDE the window is still caught.
  v_result := kiara_test.rekaz_apply(gen_random_uuid(), jsonb_build_array(
    kiara_test.rekaz_row('R1', v_today + interval '10 hours', 'hash-1')
  ));
  perform kiara_test.ok(
    (v_result->>'removed')::int = 1,
    'a disappearance inside the window is still reported'
  );
end
$$;
