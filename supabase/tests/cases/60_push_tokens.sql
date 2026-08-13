-- The field-staff push token format check.
--
-- This constraint is already live in production, and `field_staff_push_tokens`
-- holds zero rows — consistent with every registration attempt being rejected.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
begin
  insert into public.field_staff_push_tokens (
    field_staff_account_id, restaurant_id, expo_token, device_id
  ) values (
    'f0000000-0000-0000-0000-000000000001',
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
    'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    'device-abcdef123456'
  );
  perform kiara_test.ok(true, 'a real ExponentPushToken is accepted');

  insert into public.field_staff_push_tokens (
    field_staff_account_id, restaurant_id, expo_token, device_id
  ) values (
    'f0000000-0000-0000-0000-000000000002',
    '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
    'ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]',
    'device-fedcba654321'
  );
  perform kiara_test.ok(true, 'the shorter ExpoPushToken form is accepted');

  -- Garbage must still be refused; a fix must not simply drop the check.
  perform kiara_test.raises(
    $q$insert into public.field_staff_push_tokens (
         field_staff_account_id, restaurant_id, expo_token, device_id
       ) values (
         'f0000000-0000-0000-0000-000000000001',
         '2ba8f6c8-aff9-4147-8f13-cdcb732de698',
         'not-a-push-token', 'device-000000111111')$q$,
    'field_staff_push_tokens_expo_check',
    'an arbitrary string is still rejected'
  );
end
$$;
