-- Punctuality applies to orders created from a fixed moment onward, so visits
-- already running when this shipped are never planned, tracked or judged.
-- Clearing `tracking_starts_at` switches the whole feature off.

alter table public.punctuality_settings
  add column if not exists tracking_starts_at timestamptz;

insert into public.punctuality_settings (restaurant_id, tracking_starts_at)
select id, now() from public.restaurants where id = '2ba8f6c8-aff9-4147-8f13-cdcb732de698'
on conflict (restaurant_id) do update
  set tracking_starts_at = coalesce(public.punctuality_settings.tracking_starts_at, excluded.tracking_starts_at),
      updated_at = now();

-- The plan is recalculated whenever its inputs change (rescheduled time, moved
-- pin, swapped specialist) until the specialist is picked up. The signature is
-- what the current plan was calculated from.
alter table public.order_punctuality
  add column if not exists plan_signature text,
  add column if not exists specialist_arrival_source text
    check (specialist_arrival_source in ('geofence', 'driver_step')),
  add column if not exists client_arrival_source text
    check (client_arrival_source in ('geofence', 'service_start'));
