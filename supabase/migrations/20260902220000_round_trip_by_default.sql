-- A visit is a round trip unless someone says otherwise.
--
-- The driver takes the specialist to the customer and brings her back; that is
-- the normal shape of the work, and one-way is the exception (she is dropped
-- somewhere else afterwards, or a second visit follows). The column defaulted
-- to 'one_way', so every booking started as the exception and had to be
-- corrected — quietly under-pricing the trip when nobody remembered.
--
-- Existing rows are deliberately left alone: an order already dispatched was
-- carried out as whatever it says, and rewriting history to match a new default
-- would misreport what the driver actually did and what was charged for it.
-- The edit sheet stays the place to switch a specific visit to one-way.

alter table public.driver_orders
  alter column trip_type set default 'round_trip';

-- Verification after applying:
--
-- select column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'driver_orders'
--   and column_name = 'trip_type';
--   -- 'round_trip'::text
--
-- select trip_type, count(*) from public.driver_orders group by 1;
--   -- historic rows unchanged; new bookings land as round_trip.
