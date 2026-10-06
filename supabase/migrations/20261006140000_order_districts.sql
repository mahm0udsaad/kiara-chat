-- Trip cost by district.
--
-- The owner used to type every trip's fare by hand from the order detail, with
-- three districts hardcoded into the app as shortcuts. Districts are now a
-- tenant table the admins maintain, and an order that names one takes that
-- district's fare automatically. Naming one stays optional: an order can go
-- out with no district and no cost, and get its district later.
--
-- The fare is copied onto the order when the district is chosen, not looked
-- up live, so correcting a district's price never rewrites a past trip in the
-- reports. Orders that never name a district keep the price they already have.

create table if not exists public.districts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  trip_price numeric(10,2) not null,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint districts_name_check check (char_length(btrim(name)) between 2 and 80),
  constraint districts_trip_price_check check (trip_price >= 0 and trip_price <= 10000)
);

create unique index if not exists districts_restaurant_name_key
  on public.districts (restaurant_id, lower(btrim(name)));

-- Read and written only by the server with the service role, behind the
-- route's admin check. No policies: a surviving grant would be a full leak.
alter table public.districts enable row level security;
revoke all on public.districts from public, anon, authenticated;
grant select, insert, update, delete on public.districts to service_role;

-- No `on delete set null`: that cascade is an UPDATE, which would fire the
-- trigger below and wipe the fare off every past trip in the district. A
-- district in use is archived instead (the route does that).
alter table public.driver_orders
  add column if not exists district_id uuid references public.districts(id);

create index if not exists driver_orders_district_idx
  on public.driver_orders (district_id)
  where district_id is not null;

-- The district's fare lands on the outbound leg and, when a separate driver
-- brings the specialist back, on the return leg too. Clearing the district
-- clears the cost: the order is back to "no cost yet".
create or replace function kiara_private.apply_district_trip_cost()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_price numeric(10,2);
  v_district_changed boolean;
begin
  v_district_changed := tg_op = 'INSERT'
    or new.district_id is distinct from old.district_id;

  if new.district_id is null then
    if tg_op = 'UPDATE' and old.district_id is not null then
      new.price := null;
      new.return_price := null;
    end if;
    return new;
  end if;

  if not v_district_changed
    and new.return_driver_id is not distinct from old.return_driver_id then
    return new;
  end if;

  select trip_price into v_price
  from public.districts
  where id = new.district_id and restaurant_id = new.restaurant_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'DISTRICT_NOT_AVAILABLE';
  end if;

  if v_district_changed then
    new.price := v_price;
  end if;
  new.return_price := case when new.return_driver_id is null then null else v_price end;
  return new;
end;
$$;

drop trigger if exists driver_orders_district_trip_cost on public.driver_orders;
create trigger driver_orders_district_trip_cost
  before insert or update of district_id, return_driver_id on public.driver_orders
  for each row execute function kiara_private.apply_district_trip_cost();

-- Any employee may set the district from the order: it is a fact about the
-- address, not a fare. The fare follows from it in the trigger, so the
-- admin-only price guard is untouched.
do $migration$
declare
  v_oid oid;
  v_before text;
  v_after text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'kiara_command_update_driver_order';
  if v_oid is null then
    raise exception 'kiara_command_update_driver_order was not found';
  end if;
  v_before := pg_get_functiondef(v_oid);
  if position('districtId' in v_before) > 0 then
    return;
  end if;

  v_after := replace(
    v_before,
    '''price'', ''returnPrice'', ''doorPhotoPath''',
    '''price'', ''returnPrice'', ''doorPhotoPath'', ''districtId'''
  );
  if v_after = v_before then raise exception 'order patch allow-list was not found'; end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    '  insert into public.command_receipts (',
    '  if p_patch ? ''districtId''
    and nullif(p_patch->>''districtId'', '''') is not null
    and not exists (
      select 1 from public.districts
      where id = (p_patch->>''districtId'')::uuid
        and restaurant_id = p_restaurant_id
        and is_active = true
    ) then
    raise exception using errcode = ''P0001'', message = ''DISTRICT_NOT_AVAILABLE'';
  end if;

  insert into public.command_receipts ('
  );
  if v_after = v_before then raise exception 'order receipt insertion point was not found'; end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    '    door_photo_path = case when p_patch ? ''doorPhotoPath''',
    '    district_id = case when p_patch ? ''districtId''
      then nullif(p_patch->>''districtId'', '''')::uuid else district_id end,
    door_photo_path = case when p_patch ? ''doorPhotoPath'''
  );
  if v_after = v_before then raise exception 'order district update point was not found'; end if;

  execute v_after;
end;
$migration$;

-- Dispatch may name the district in the same transaction. The v2 command runs
-- unchanged; the district is attached afterwards to the row this command just
-- reserved, and the trigger prices it.
create or replace function public.kiara_command_prepare_order_dispatch_v3(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_actor_team_member_id uuid,
  p_actor_role text,
  p_specialist_id uuid,
  p_second_specialist_id uuid,
  p_driver_id uuid,
  p_trip_type text,
  p_price numeric,
  p_customer_location text,
  p_driver_note text,
  p_specialist_note text,
  p_specialist_voice_path text,
  p_driver_phone text,
  p_specialist_phone text,
  p_second_specialist_phone text,
  p_door_photo_path text,
  p_district_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_response jsonb;
begin
  if p_district_id is not null and not exists (
    select 1 from public.districts
    where id = p_district_id
      and restaurant_id = p_restaurant_id
      and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'DISTRICT_NOT_AVAILABLE';
  end if;

  v_response := public.kiara_command_prepare_order_dispatch_v2(
    p_restaurant_id, p_order_id, p_expected_version, p_idempotency_key,
    p_actor_user_id, p_actor_team_member_id, p_actor_role, p_specialist_id,
    p_second_specialist_id, p_driver_id, p_trip_type, p_price,
    p_customer_location, p_driver_note, p_specialist_note,
    p_specialist_voice_path, p_driver_phone, p_specialist_phone,
    p_second_specialist_phone, p_door_photo_path
  );

  if coalesce((v_response->>'replayed')::boolean, false) then
    return v_response;
  end if;

  -- No district chosen leaves whatever the order already carries.
  if p_district_id is not null then
    update public.driver_orders
    set district_id = p_district_id
    where id = p_order_id
      and restaurant_id = p_restaurant_id
      and active_dispatch_command_id = p_idempotency_key;
  end if;

  v_response := v_response || jsonb_build_object('districtId', p_district_id);
  update public.command_receipts
  set response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

revoke all on function public.kiara_command_prepare_order_dispatch_v3(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, uuid, text,
  numeric, text, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.kiara_command_prepare_order_dispatch_v3(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, uuid, text,
  numeric, text, text, text, text, text, text, text, text, uuid
) to service_role;

-- The three districts the app used to hardcode, so nothing is lost on day one.
insert into public.districts (restaurant_id, name, trip_price)
select r.id, v.name, v.trip_price
from public.restaurants r
cross join (values
  ('حي الفهد', 25::numeric),
  ('الفيصليه', 25::numeric),
  ('القابل', 35::numeric)
) as v(name, trip_price)
where r.id = '2ba8f6c8-aff9-4147-8f13-cdcb732de698'
on conflict do nothing;
