-- Which languages a specialist may be given.
--
-- A specialist reads what her row says, and the roster picker has always
-- offered English while the constraint refused it: choosing it failed, and the
-- application carried a hardcoded UUID override for the one specialist who
-- needs it. Assert the whole accepted set, so a language added to the app is
-- added here too rather than silently rejected at the database.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_tenant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  v_code text;
begin
  foreach v_code in array array['ar', 'en', 'id', 'fil', 'ru', 'am'] loop
    insert into public.specialists (restaurant_id, full_name, phone, preferred_language)
    values (v_tenant, 'Lang ' || v_code, '+96650000' || abs(hashtext(v_code)) % 10000, v_code);
    perform kiara_test.ok(true, format('preferred_language %L is accepted', v_code));
  end loop;

  perform kiara_test.raises(
    format(
      $q$insert into public.specialists (restaurant_id, full_name, phone, preferred_language)
         values (%L, 'Lang bogus', '+966509999999', 'klingon')$q$,
      v_tenant
    ),
    'specialists_preferred_language_check',
    'an unknown language code is still refused'
  );
end $$;
