-- Call records and the webhook retry guard.
--
-- The unique key on call_events is the load-bearing part. Meta retries both
-- the `calls` and the `statuses` webhooks, and without that key a duplicate
-- `terminate` would re-apply the transition and overwrite a finished call's
-- duration with a second, later one.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  kiara constant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  call_row uuid;
begin
  insert into public.calls (
    restaurant_id, customer_phone, wa_call_id, direction
  ) values (
    kiara, '+966502376231', 'wacid.TEST1', 'business_initiated'
  ) returning id into call_row;
  perform kiara_test.ok(true, 'an outbound call is recorded');

  -- Same constraint and same reason as call_permissions: national-format
  -- digits must fail at the column rather than silently never matching.
  perform kiara_test.raises(
    $q$insert into public.calls (restaurant_id, customer_phone, wa_call_id, direction)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', '502376231',
               'wacid.TEST2', 'business_initiated')$q$,
    'calls_customer_phone_check',
    'a national-format number is rejected on a call'
  );

  -- The idempotency anchor: one row per Meta call id.
  perform kiara_test.raises(
    $q$insert into public.calls (restaurant_id, customer_phone, wa_call_id, direction)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', '+966502376231',
               'wacid.TEST1', 'user_initiated')$q$,
    'calls_restaurant_id_wa_call_id_key',
    'the same Meta call id cannot be recorded twice'
  );

  perform kiara_test.raises(
    $q$insert into public.calls (restaurant_id, customer_phone, wa_call_id, direction)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', '+966502376231',
               'wacid.TEST3', 'sideways')$q$,
    'calls_direction_check',
    'an unknown call direction is rejected'
  );

  perform kiara_test.raises(
    $q$insert into public.calls (restaurant_id, customer_phone, wa_call_id, direction, status)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', '+966502376231',
               'wacid.TEST4', 'business_initiated', 'humming')$q$,
    'calls_status_check',
    'an unknown call status is rejected'
  );

  perform kiara_test.raises(
    $q$insert into public.calls (restaurant_id, customer_phone, wa_call_id, direction, duration_seconds)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', '+966502376231',
               'wacid.TEST5', 'business_initiated', -1)$q$,
    'calls_duration_seconds_check',
    'a negative duration is rejected'
  );

  -- A retried webhook conflicts instead of re-applying its transition.
  insert into public.call_events (restaurant_id, call_id, wa_call_id, event)
  values (kiara, call_row, 'wacid.TEST1', 'terminate');
  perform kiara_test.ok(true, 'the first terminate event is accepted');

  perform kiara_test.raises(
    $q$insert into public.call_events (restaurant_id, call_id, wa_call_id, event)
       select '2ba8f6c8-aff9-4147-8f13-cdcb732de698', id, 'wacid.TEST1', 'terminate'
         from public.calls where wa_call_id = 'wacid.TEST1'$q$,
    'call_events_restaurant_id_wa_call_id_event_key',
    'a retried terminate webhook is refused, not re-applied'
  );

  -- Different events on the same call are independent — a call legitimately
  -- emits ringing, then connect, then terminate.
  insert into public.call_events (restaurant_id, call_id, wa_call_id, event)
  values (kiara, call_row, 'wacid.TEST1', 'connect');
  perform kiara_test.ok(true, 'a different event on the same call is accepted');

  perform kiara_test.raises(
    $q$insert into public.call_events (restaurant_id, call_id, wa_call_id, event)
       select '2ba8f6c8-aff9-4147-8f13-cdcb732de698', id, 'wacid.TEST1', 'pondering'
         from public.calls where wa_call_id = 'wacid.TEST1'$q$,
    'call_events_event_check',
    'an unknown lifecycle event is rejected'
  );

  perform kiara_test.ok(
    (select count(*) from public.call_events where call_id = call_row) = 2,
    'exactly the two accepted events are stored'
  );

  delete from public.calls where id = call_row;
  perform kiara_test.ok(
    not exists (select 1 from public.call_events where call_id = call_row),
    'call events are removed with the call'
  );
end
$$;

-- Losing the conversation must not lose the call: the customer still rang, and
-- the record is what the owner's report counts.
do $$
declare
  kiara constant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  conversation_row uuid;
  call_row uuid;
begin
  insert into public.conversations (restaurant_id, customer_phone)
  values (kiara, '+966502376299')
  returning id into conversation_row;

  insert into public.calls (
    restaurant_id, conversation_id, customer_phone, wa_call_id, direction
  ) values (
    kiara, conversation_row, '+966502376299', 'wacid.ORPHAN', 'business_initiated'
  ) returning id into call_row;

  delete from public.conversations where id = conversation_row;
  perform kiara_test.ok(
    exists (select 1 from public.calls where id = call_row),
    'a call survives deletion of its conversation'
  );
  perform kiara_test.ok(
    (select conversation_id from public.calls where id = call_row) is null,
    'the orphaned call keeps no dangling conversation reference'
  );
end
$$;

do $$
begin
  perform kiara_test.ok(
    not has_table_privilege('anon', 'public.calls', 'SELECT'),
    'anon cannot read calls'
  );
  perform kiara_test.ok(
    not has_table_privilege('authenticated', 'public.calls', 'SELECT'),
    'authenticated cannot read calls'
  );
  perform kiara_test.ok(
    not has_table_privilege('anon', 'public.call_events', 'SELECT'),
    'anon cannot read call_events'
  );
end
$$;
