-- What each field phone last said about location access.
--
-- Trip GPS is optional evidence: a driver who never grants it still runs every
-- step exactly as before. This row is how customer service tells "the driver
-- refused" from "the phone has not reported yet" and from "GPS is on but the
-- trip has not started". Requests to turn it on are audited in
-- operation_events (`field.location_permission_requested`), like reminders.
--
-- One row per field account (a driver normally has one phone), written only by
-- service-role APIs. Additive: nothing existing reads or depends on it, and
-- the server treats a missing table as "not reported yet".

create table if not exists public.field_staff_location_status (
  field_staff_account_id uuid primary key
    references public.field_staff_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  -- granted: may track. denied: refused, can be asked again. blocked: refused
  -- and the OS will not show the dialog again (Settings only). undetermined:
  -- never asked. unavailable: no location module, or location services off.
  permission text not null check (
    permission in ('granted', 'denied', 'blocked', 'undetermined', 'unavailable')
  ),
  services_enabled boolean,
  -- Whether this build can keep tracking while Google Maps is in front.
  background_capable boolean,
  platform text check (platform is null or platform in ('android', 'ios', 'web')),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  reported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists field_staff_location_status_restaurant_idx
  on public.field_staff_location_status (restaurant_id);

alter table public.field_staff_location_status enable row level security;

revoke all on public.field_staff_location_status from public, anon, authenticated;
grant select, insert, update, delete on public.field_staff_location_status to service_role;

drop trigger if exists touch_field_staff_location_status_updated_at
  on public.field_staff_location_status;
create trigger touch_field_staff_location_status_updated_at
  before update on public.field_staff_location_status
  for each row execute function kiara_private.tg_touch_punctuality_updated_at();

comment on table public.field_staff_location_status is
  'Last location-permission state reported by each field phone. Service-role only.';
