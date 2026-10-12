-- A one-way trip costs half the district's fare.
--
-- A district's `trip_price` is the fare for the whole visit: the driver takes
-- the specialist out and brings her back. A one-way leg is half of it, so the
-- two ways of running a visit cost the same:
--
--   round trip, one driver          price = fare
--   one way, nobody assigned back   price = fare / 2
--   one way + a return driver       price = fare / 2, return_price = fare / 2
--
-- Before this, every leg took the full fare: a one-way trip cost as much as a
-- round trip, and a visit split between two drivers cost double.
--
-- The trip type now prices the order too, so the trigger also fires when it
-- changes. Trips already priced are left alone: this only applies from the
-- next time an order's district, trip type or return driver is set.

create or replace function kiara_private.apply_district_trip_cost()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_fare numeric(10,2);
  v_leg numeric(10,2);
  v_reprice_outbound boolean;
begin
  v_reprice_outbound := tg_op = 'INSERT'
    or new.district_id is distinct from old.district_id
    or new.trip_type is distinct from old.trip_type;

  if new.district_id is null then
    if tg_op = 'UPDATE' and old.district_id is not null then
      new.price := null;
      new.return_price := null;
    end if;
    return new;
  end if;

  if not v_reprice_outbound
    and new.return_driver_id is not distinct from old.return_driver_id then
    return new;
  end if;

  -- The district's fare as it stands now. A trip-type change therefore
  -- re-prices from today's fare, the same as re-choosing the district would.
  select trip_price into v_fare
  from public.districts
  where id = new.district_id and restaurant_id = new.restaurant_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'DISTRICT_NOT_AVAILABLE';
  end if;
  v_leg := round(v_fare / 2, 2);

  if v_reprice_outbound then
    new.price := case when new.trip_type = 'round_trip' then v_fare else v_leg end;
  end if;
  new.return_price := case when new.return_driver_id is null then null else v_leg end;
  return new;
end;
$$;

drop trigger if exists driver_orders_district_trip_cost on public.driver_orders;
create trigger driver_orders_district_trip_cost
  before insert or update of district_id, return_driver_id, trip_type on public.driver_orders
  for each row execute function kiara_private.apply_district_trip_cost();
