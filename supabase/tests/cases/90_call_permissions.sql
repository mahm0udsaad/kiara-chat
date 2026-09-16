-- Call permission storage.
--
-- The phone-format check is the point of this case. This codebase stores
-- `+E.164` in every phone column while `normalizePhone()` returns national
-- digits, and writing the national form has already produced silent `eq()`
-- misses rather than errors. The constraint turns that class of bug into an
-- insert failure, so it has to actually reject the national form.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  kiara constant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  -- Not `permission_id`: that is also a column on call_permission_events, and
  -- PL/pgSQL resolves the ambiguity by erroring out.
  perm_id uuid;
  touched timestamptz;
begin
  insert into public.call_permissions (restaurant_id, customer_phone, status)
  values (kiara, '+966502376231', 'requested')
  returning id into perm_id;
  perform kiara_test.ok(true, 'an E.164 phone is accepted');

  -- The exact shape normalizePhone() returns. Storing it would make every
  -- lookup miss, so it must fail loudly here instead.
  perform kiara_test.raises(
    $q$insert into public.call_permissions (restaurant_id, customer_phone)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', '502376231')$q$,
    'call_permissions_customer_phone_check',
    'a national-format number is rejected'
  );

  perform kiara_test.raises(
    $q$insert into public.call_permissions (restaurant_id, customer_phone)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', '+0502376231')$q$,
    'call_permissions_customer_phone_check',
    'a trunk zero after the plus is rejected'
  );

  -- Only the six states the app knows how to render.
  perform kiara_test.raises(
    $q$insert into public.call_permissions (restaurant_id, customer_phone, status)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', '+966502376232', 'maybe')$q$,
    'call_permissions_status_check',
    'an unknown permission status is rejected'
  );

  -- One row per customer: the state is upserted in place, and a second row
  -- would give the inbox two different answers for the same phone.
  perform kiara_test.raises(
    $q$insert into public.call_permissions (restaurant_id, customer_phone)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', '+966502376231')$q$,
    'call_permissions_restaurant_id_customer_phone_key',
    'a second row for the same customer is rejected'
  );

  -- updated_at is maintained by the trigger, not the app. Asserting that it
  -- *advances* would not work here: now() is the transaction timestamp and
  -- this whole block is one transaction, so every now() inside it is the same
  -- value. What matters is that the trigger overrides whatever the writer
  -- supplies, which is testable in one transaction.
  touched := now() - interval '3 days';
  update public.call_permissions
     set status = 'granted', updated_at = touched
   where id = perm_id;
  perform kiara_test.ok(
    (select updated_at from public.call_permissions where id = perm_id) > touched,
    'the touch trigger overrides an updated_at supplied by the writer'
  );

  -- History survives independently of the current state, but goes with the
  -- customer when their permission row is deleted.
  insert into public.call_permission_events (
    restaurant_id, permission_id, customer_phone, event
  ) values (kiara, perm_id, '+966502376231', 'granted');
  perform kiara_test.ok(true, 'a history row is accepted');

  perform kiara_test.raises(
    $q$insert into public.call_permission_events (
         restaurant_id, permission_id, customer_phone, event
       ) values (
         '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
         (select id from public.call_permissions where customer_phone = '+966502376231'),
         '+966502376231', 'pondered')$q$,
    'call_permission_events_event_check',
    'an unknown history event is rejected'
  );

  delete from public.call_permissions where id = perm_id;
  perform kiara_test.ok(
    not exists (select 1 from public.call_permission_events where permission_id = perm_id),
    'history is removed with the permission it describes'
  );
end
$$;

-- Neither table is reachable from the browser or the mobile app; both go
-- through API routes that carry the team-member authorization.
do $$
begin
  perform kiara_test.ok(
    not has_table_privilege('anon', 'public.call_permissions', 'SELECT'),
    'anon cannot read call_permissions'
  );
  perform kiara_test.ok(
    not has_table_privilege('authenticated', 'public.call_permissions', 'SELECT'),
    'authenticated cannot read call_permissions'
  );
  perform kiara_test.ok(
    not has_table_privilege('anon', 'public.call_permission_events', 'SELECT'),
    'anon cannot read call_permission_events'
  );
end
$$;
