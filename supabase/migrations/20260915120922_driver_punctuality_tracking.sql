-- Driver punctuality evidence. Precise points never leave service-role APIs.
-- `driver_orders.arrival_at` remains the scheduled arrival/service time at the
-- client; every planned milestone is calculated backwards from it.

alter table public.specialists
  add column if not exists pickup_latitude double precision,
  add column if not exists pickup_longitude double precision,
  add column if not exists pickup_location_label text,
  add constraint specialists_pickup_coordinates_check check (
    (pickup_latitude is null and pickup_longitude is null)
    or (pickup_latitude between -90 and 90 and pickup_longitude between -180 and 180)
  ),
  add constraint specialists_pickup_location_label_check check (
    pickup_location_label is null or char_length(btrim(pickup_location_label)) between 3 and 500
  );

create table public.punctuality_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  pickup_buffer_minutes integer not null default 10 check (pickup_buffer_minutes between 0 and 60),
  grace_minutes integer not null default 5 check (grace_minutes between 0 and 30),
  geofence_metres integer not null default 125 check (geofence_metres between 100 and 150),
  stale_after_seconds integer not null default 180 check (stale_after_seconds between 60 and 900),
  fallback_speed_kph numeric(5,2) not null default 28 check (fallback_speed_kph between 5 and 100),
  updated_at timestamptz not null default now()
);

create table public.order_punctuality (
  order_id uuid primary key references public.driver_orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  specialist_latitude double precision not null check (specialist_latitude between -90 and 90),
  specialist_longitude double precision not null check (specialist_longitude between -180 and 180),
  client_latitude double precision not null check (client_latitude between -90 and 90),
  client_longitude double precision not null check (client_longitude between -180 and 180),
  specialist_client_distance_metres integer not null check (specialist_client_distance_metres >= 0),
  specialist_client_duration_seconds integer not null check (specialist_client_duration_seconds >= 0),
  route_source text not null check (route_source in ('osrm','haversine')),
  route_calculated_at timestamptz not null,
  planned_specialist_arrival_at timestamptz not null,
  planned_driver_departure_at timestamptz,
  driver_start_latitude double precision,
  driver_start_longitude double precision,
  driver_start_route_distance_metres integer,
  driver_start_route_duration_seconds integer,
  driver_start_route_source text check (driver_start_route_source in ('osrm','haversine')),
  driver_departed_at timestamptz,
  specialist_geofence_at timestamptz,
  client_geofence_at timestamptz,
  last_location_at timestamptz,
  last_location_received_at timestamptz,
  classification text not null default 'pending' check (classification in (
    'pending','on_time','driver_late_to_specialist','specialist_delayed_departure',
    'driver_trip_late_to_client','uncertain'
  )),
  certainty text not null default 'uncertain' check (certainty in ('confirmed','uncertain')),
  uncertainty_code text check (uncertainty_code in (
    'missing_specialist_location','missing_client_location','missing_route',
    'missing_gps','stale_gps','missing_milestone'
  )),
  late_reason_code text check (late_reason_code in (
    'traffic','specialist_not_ready','incorrect_specialist_location',
    'incorrect_client_location','vehicle_issue','previous_order_finished_late','other'
  )),
  late_reason_note text,
  reason_submitted_by uuid references auth.users(id),
  reason_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_punctuality_start_coordinates_check check (
    (driver_start_latitude is null and driver_start_longitude is null)
    or (driver_start_latitude between -90 and 90 and driver_start_longitude between -180 and 180)
  ),
  constraint order_punctuality_late_reason_check check (
    late_reason_code is null
    or (late_reason_note is not null and char_length(btrim(late_reason_note)) between 3 and 500)
  )
);

create index order_punctuality_restaurant_idx
  on public.order_punctuality (restaurant_id, planned_specialist_arrival_at);

create table public.driver_trip_locations (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.driver_orders(id) on delete cascade,
  field_staff_account_id uuid not null references public.field_staff_accounts(id) on delete restrict,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision not null check (accuracy_meters between 0 and 250),
  speed_mps double precision check (speed_mps is null or speed_mps between 0 and 100),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint driver_trip_locations_clock_check check (
    captured_at <= received_at + interval '2 minutes'
    and captured_at >= received_at - interval '15 minutes'
  )
);

create index driver_trip_locations_order_time_idx
  on public.driver_trip_locations (restaurant_id, order_id, captured_at desc);

alter table public.punctuality_settings enable row level security;
alter table public.order_punctuality enable row level security;
alter table public.driver_trip_locations enable row level security;

-- Location reads and writes are intentionally brokered by authenticated,
-- assignment-aware server APIs. There is no direct Data API access.
revoke all on public.punctuality_settings, public.order_punctuality,
  public.driver_trip_locations from public, anon, authenticated;
grant select, insert, update, delete on public.punctuality_settings,
  public.order_punctuality, public.driver_trip_locations to service_role;
grant usage, select on sequence public.driver_trip_locations_id_seq to service_role;

create or replace function kiara_private.tg_touch_punctuality_updated_at()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function kiara_private.tg_touch_punctuality_updated_at()
  from public, anon, authenticated;
create trigger touch_order_punctuality_updated_at before update on public.order_punctuality
  for each row execute function kiara_private.tg_touch_punctuality_updated_at();

comment on table public.driver_trip_locations is
  'Precise driver GPS collected only between accepted-trip departure and client arrival/service start.';
