-- A durable link from an operational order to the Rekaz reservation it serves.
--
-- The calendar previously had to pair a Rekaz visit with a local order by
-- customer phone plus day. That guess breaks in exactly the cases that matter:
-- two bookings for the same customer on one day, a rescheduled arrival time,
-- or a phone recorded in a different format. Merging on the source id makes a
-- visit card either linked or not, with no middle ground.

alter table public.driver_orders
  add column if not exists rekaz_source_id text;

-- One operational order per reservation, per tenant. Partial, so the many
-- orders created from a conversation rather than from Rekaz are unaffected.
create unique index if not exists driver_orders_rekaz_source_key
  on public.driver_orders (restaurant_id, rekaz_source_id)
  where rekaz_source_id is not null;

create index if not exists driver_orders_rekaz_lookup_idx
  on public.driver_orders (restaurant_id, arrival_at)
  where rekaz_source_id is not null;

-- Verification after applying:
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'driver_orders'
--   and column_name = 'rekaz_source_id';
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and indexname like 'driver_orders_rekaz%';
