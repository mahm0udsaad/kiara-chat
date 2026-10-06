-- What each field phone last said about location access.
--
-- Service-role only, one row per field account, upserted on every report, and
-- gone with the account. A permission word the app does not know is refused
-- rather than stored, so the order screen never has to guess what it means.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_tenant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  v_driver_account uuid := 'f0000000-0000-0000-0000-000000000001';
  v_role text;
  v_first timestamptz;
  v_permission text;
  v_rows int;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    perform kiara_test.ok(
      not has_table_privilege(v_role, 'public.field_staff_location_status', 'select')
        and not has_table_privilege(v_role, 'public.field_staff_location_status', 'insert')
        and not has_table_privilege(v_role, 'public.field_staff_location_status', 'update'),
      format('%s cannot touch field_staff_location_status', v_role)
    );
  end loop;
  perform kiara_test.ok(
    has_table_privilege('service_role', 'public.field_staff_location_status', 'insert'),
    'service_role can write location status'
  );

  insert into public.field_staff_location_status (
    field_staff_account_id, restaurant_id, permission, services_enabled,
    background_capable, platform, app_version
  ) values (v_driver_account, v_tenant, 'denied', true, true, 'android', '1.1.1')
  returning updated_at into v_first;

  -- The phone's next report replaces the row in place.
  insert into public.field_staff_location_status (
    field_staff_account_id, restaurant_id, permission, services_enabled, platform
  ) values (v_driver_account, v_tenant, 'granted', true, 'android')
  on conflict (field_staff_account_id) do update
    set permission = excluded.permission,
        services_enabled = excluded.services_enabled,
        reported_at = now();

  select permission into v_permission
  from public.field_staff_location_status
  where field_staff_account_id = v_driver_account;
  perform kiara_test.ok(v_permission = 'granted', 'a later report upserts the same row');

  select count(*) into v_rows
  from public.field_staff_location_status
  where field_staff_account_id = v_driver_account;
  perform kiara_test.ok(v_rows = 1, 'one row per field account');

  perform kiara_test.raises(
    format(
      $q$update public.field_staff_location_status set permission = 'maybe'
         where field_staff_account_id = %L$q$,
      v_driver_account
    ),
    'field_staff_location_status_permission_check',
    'an unknown permission state is refused'
  );

  perform kiara_test.raises(
    format(
      $q$update public.field_staff_location_status set platform = 'symbian'
         where field_staff_account_id = %L$q$,
      v_driver_account
    ),
    'field_staff_location_status_platform_check',
    'an unknown platform is refused'
  );

  delete from public.field_staff_location_status where field_staff_account_id = v_driver_account;
end $$;
