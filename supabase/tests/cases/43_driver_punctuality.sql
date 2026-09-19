\set ON_ERROR_STOP on
set client_min_messages = notice;

\set tenant '2ba8f6c8-aff9-4147-8f13-cdcb732de698'
\set order 'e0000000-0000-0000-0000-000000000003'

insert into public.punctuality_settings (restaurant_id)
values (:'tenant') on conflict (restaurant_id) do nothing;

do $$
begin
  perform kiara_test.ok(
    (select geofence_metres between 100 and 150 from public.punctuality_settings
      where restaurant_id = '2ba8f6c8-aff9-4147-8f13-cdcb732de698'),
    'the configured geofence is constrained to the requested range'
  );
  perform kiara_test.ok(
    (select relrowsecurity from pg_class where oid = 'public.driver_trip_locations'::regclass),
    'precise driver locations have RLS enabled'
  );
  perform kiara_test.ok(
    not has_table_privilege('authenticated', 'public.driver_trip_locations', 'select'),
    'authenticated clients cannot read precise location rows directly'
  );
  perform kiara_test.ok(
    not has_table_privilege('anon', 'public.order_punctuality', 'select'),
    'anonymous clients cannot read punctuality evidence directly'
  );
end $$;

insert into public.order_punctuality (
  order_id, restaurant_id,
  specialist_latitude, specialist_longitude, client_latitude, client_longitude,
  specialist_client_distance_metres, specialist_client_duration_seconds,
  route_source, route_calculated_at, planned_specialist_arrival_at
) values (
  :'order', :'tenant', 24.7136, 46.6753, 24.7200, 46.6800,
  1000, 300, 'haversine', now(), now() + interval '30 minutes'
);

do $$
begin
  perform kiara_test.raises(
    $q$update public.order_punctuality set late_reason_code='traffic', late_reason_note=null
       where order_id='e0000000-0000-0000-0000-000000000003'$q$,
    'order_punctuality_late_reason_check',
    'a structured reason cannot be saved without its required note'
  );
  perform kiara_test.raises(
    $q$update public.punctuality_settings set geofence_metres=200
       where restaurant_id='2ba8f6c8-aff9-4147-8f13-cdcb732de698'$q$,
    'punctuality_settings_geofence_metres_check',
    'a geofence outside 100-150 metres is rejected'
  );
end $$;


-- New-orders-only rollout: the follow-up migration stamps a start time once
-- and never moves it, so re-running it cannot pull older orders in.
do $$
declare v_first timestamptz;
begin
  update public.punctuality_settings set tracking_starts_at = now() - interval '1 hour'
    where restaurant_id = '2ba8f6c8-aff9-4147-8f13-cdcb732de698'
    returning tracking_starts_at into v_first;
  insert into public.punctuality_settings (restaurant_id, tracking_starts_at)
  values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', now() + interval '1 day')
  on conflict (restaurant_id) do update
    set tracking_starts_at = coalesce(public.punctuality_settings.tracking_starts_at, excluded.tracking_starts_at);
  perform kiara_test.ok(
    (select tracking_starts_at = v_first from public.punctuality_settings
      where restaurant_id = '2ba8f6c8-aff9-4147-8f13-cdcb732de698'),
    're-applying the rollout keeps the original start time'
  );
  perform kiara_test.raises(
    $q$update public.order_punctuality set client_arrival_source='guess'
       where order_id='e0000000-0000-0000-0000-000000000003'$q$,
    'order_punctuality_client_arrival_source_check',
    'client arrival evidence is either the GPS fence or the service-start tap'
  );
end $$;
