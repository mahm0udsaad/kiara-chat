-- The customer's address is part of the dispatch, not a field to fix later.
--
-- A booking raised from Rekaz usually arrives with no address at all, and the
-- order carried the `LOCATION_UNSET` placeholder until somebody noticed. The
-- placeholder then travelled into the driver's instructions verbatim, so a car
-- was assigned to a visit nobody could route. Warning about it was not enough:
-- the employee could read the warning and dispatch anyway.
--
-- The address is now settled in the same statement that assigns the order, and
-- refused outright when it is blank or still the placeholder — the command is
-- where "you cannot dispatch to nowhere" has to live, because the UI's ordering
-- is a convenience and this is a rule.

drop function if exists public.kiara_command_prepare_order_dispatch(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, text,
  numeric, text, text, text
);

create or replace function public.kiara_command_prepare_order_dispatch(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_actor_team_member_id uuid,
  p_actor_role text,
  p_specialist_id uuid,
  p_driver_id uuid,
  p_trip_type text,
  p_price numeric,
  p_customer_location text,
  p_driver_note text,
  p_specialist_note text,
  p_specialist_voice_path text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_order public.driver_orders%rowtype;
  v_existing public.command_receipts%rowtype;
  v_location text := btrim(coalesce(p_customer_location, ''));
  v_response jsonb;
  v_actor_type text;
begin
  if p_actor_role not in ('admin', 'agent') then
    raise exception using errcode = 'P0001', message = 'ORDER_FORBIDDEN';
  end if;
  if p_trip_type not in ('one_way', 'round_trip') then
    raise exception using errcode = 'P0001', message = 'ORDER_TRIP_TYPE_INVALID';
  end if;
  -- The placeholder is a missing field wearing a value's clothes, so it is
  -- rejected on the same terms as an empty string.
  if char_length(v_location) < 3 or v_location like 'لم يُحدد الموقع%' then
    raise exception using errcode = 'P0001', message = 'ORDER_LOCATION_REQUIRED';
  end if;
  if char_length(v_location) > 500 then
    raise exception using errcode = 'P0001', message = 'ORDER_LOCATION_TOO_LONG';
  end if;
  if char_length(btrim(coalesce(p_driver_note, ''))) < 2 then
    raise exception using errcode = 'P0001', message = 'DRIVER_MESSAGE_INVALID';
  end if;
  if char_length(p_driver_note) > 3000
    or char_length(coalesce(p_specialist_note, '')) > 3000 then
    raise exception using errcode = 'P0001', message = 'DISPATCH_MESSAGE_TOO_LONG';
  end if;

  select * into v_order
  from public.driver_orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  select * into v_existing
  from public.command_receipts
  where restaurant_id = p_restaurant_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.command_type <> 'order.dispatch'
      or v_existing.aggregate_id <> p_order_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing.status = 'completed' then
      return v_existing.response || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'COMMAND_IN_PROGRESS';
  end if;

  if v_order.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'ORDER_VERSION_CONFLICT',
      detail = jsonb_build_object(
        'currentVersion', v_order.version,
        'updatedAt', v_order.updated_at,
        'updatedBy', v_order.updated_by
      )::text;
  end if;
  if v_order.status = 'sent' or v_order.dispatch_state = 'sent' then
    raise exception using errcode = 'P0001', message = 'ORDER_ALREADY_DISPATCHED';
  end if;
  if v_order.active_dispatch_command_id is not null then
    raise exception using errcode = 'P0001', message = 'ORDER_DISPATCH_IN_PROGRESS';
  end if;
  if not exists (
    select 1 from public.specialists
    where id = p_specialist_id and restaurant_id = p_restaurant_id and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'SPECIALIST_NOT_AVAILABLE';
  end if;
  if not exists (
    select 1 from public.drivers
    where id = p_driver_id and restaurant_id = p_restaurant_id and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'DRIVER_NOT_AVAILABLE';
  end if;

  insert into public.command_receipts (
    restaurant_id, idempotency_key, command_type, aggregate_type,
    aggregate_id, actor_user_id, actor_team_member_id
  ) values (
    p_restaurant_id, p_idempotency_key, 'order.dispatch', 'driver_order',
    p_order_id, p_actor_user_id, p_actor_team_member_id
  );

  -- Address, assignment and notes are settled together: what the field team
  -- opens in the app is exactly what the employee confirmed, and there is no
  -- window where an order is assigned but unaddressed or unexplained.
  update public.driver_orders
  set specialist_id = p_specialist_id,
      driver_id = p_driver_id,
      trip_type = p_trip_type,
      price = p_price,
      customer_location = v_location,
      driver_note = btrim(p_driver_note),
      specialist_note = nullif(btrim(coalesce(p_specialist_note, '')), ''),
      specialist_voice_path = nullif(btrim(coalesce(p_specialist_voice_path, '')), ''),
      dispatch_state = 'processing',
      active_dispatch_command_id = p_idempotency_key,
      dispatch_started_at = now(),
      updated_by = p_actor_team_member_id,
      updated_at = now(),
      version = version + 1
  where id = p_order_id and restaurant_id = p_restaurant_id
  returning * into v_order;

  v_actor_type := case when p_actor_team_member_id is null then 'owner' else 'team_member' end;
  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, actor_user_id, actor_team_member_id, idempotency_key, payload
  ) values (
    p_restaurant_id, 'driver_order', p_order_id, 'order.dispatch_prepared', v_actor_type,
    p_actor_role, p_actor_user_id, p_actor_team_member_id, p_idempotency_key,
    jsonb_build_object(
      'specialistId', p_specialist_id,
      'driverId', p_driver_id,
      'version', v_order.version,
      'channel', 'app',
      'locationChanged', v_location is distinct from v_order.customer_location,
      'hasSpecialistNote', v_order.specialist_note is not null,
      'hasSpecialistVoice', v_order.specialist_voice_path is not null
    )
  );

  v_response := jsonb_build_object(
    'order', to_jsonb(v_order),
    'commandId', p_idempotency_key,
    'replayed', false
  );
  update public.command_receipts
  set response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

revoke all on function public.kiara_command_prepare_order_dispatch(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, text,
  numeric, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.kiara_command_prepare_order_dispatch(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, text,
  numeric, text, text, text, text
) to service_role;

-- Verification after applying:
--
-- select p.oid::regprocedure
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'kiara_command_prepare_order_dispatch';
--   -- exactly one row, with p_customer_location between p_price and p_driver_note
--
-- select count(*) from public.driver_orders
-- where status = 'sent' and customer_location like 'لم يُحدد الموقع%';
--   -- 0 going forward: a dispatched order always carries a real address.
