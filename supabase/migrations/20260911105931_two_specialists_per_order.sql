-- One visit can be carried out by two different specialists. The original
-- specialist_id stays primary so older clients continue to work during rollout.
alter table public.driver_orders
  add column if not exists second_specialist_id uuid
    references public.specialists(id) on delete set null;

alter table public.driver_orders
  drop constraint if exists driver_orders_specialists_must_differ;
alter table public.driver_orders
  add constraint driver_orders_specialists_must_differ
  check (
    second_specialist_id is null
    or (
      specialist_id is not null
      and second_specialist_id is distinct from specialist_id
    )
  );

create index if not exists driver_orders_second_specialist_arrival_idx
  on public.driver_orders (restaurant_id, second_specialist_id, arrival_at)
  where second_specialist_id is not null;

-- Keep the existing command callable for old builds. The v2 wrapper runs it
-- in the same transaction, then attaches and queues the optional colleague.
create or replace function public.kiara_command_prepare_order_dispatch_v2(
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
  p_door_photo_path text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_response jsonb;
  v_second_outbox_id uuid;
begin
  if p_second_specialist_id is not null then
    if p_second_specialist_id = p_specialist_id then
      raise exception using errcode = 'P0001', message = 'SPECIALISTS_MUST_DIFFER';
    end if;
    if not exists (
      select 1 from public.specialists
      where id = p_second_specialist_id
        and restaurant_id = p_restaurant_id
        and is_active = true
    ) then
      raise exception using errcode = 'P0001', message = 'SECOND_SPECIALIST_NOT_AVAILABLE';
    end if;
  end if;

  v_response := public.kiara_command_prepare_order_dispatch(
    p_restaurant_id, p_order_id, p_expected_version, p_idempotency_key,
    p_actor_user_id, p_actor_team_member_id, p_actor_role, p_specialist_id,
    p_driver_id, p_trip_type, p_price, p_customer_location, p_driver_note,
    p_specialist_note, p_specialist_voice_path, p_driver_phone,
    p_specialist_phone, p_door_photo_path
  );

  -- A completed replay already contains the response produced by this wrapper.
  if coalesce((v_response->>'replayed')::boolean, false) then
    return v_response;
  end if;

  update public.driver_orders
  set second_specialist_id = p_second_specialist_id
  where id = p_order_id
    and restaurant_id = p_restaurant_id
    and active_dispatch_command_id = p_idempotency_key;

  if p_second_specialist_id is not null
    and char_length(btrim(coalesce(p_second_specialist_phone, ''))) >= 8
    and char_length(btrim(coalesce(p_specialist_note, ''))) >= 2 then
    insert into public.outbox_events (
      restaurant_id, command_id, aggregate_type, aggregate_id, event_type,
      idempotency_key, payload
    ) values (
      p_restaurant_id, p_idempotency_key, 'driver_order', p_order_id,
      'whatsapp.specialist.dispatch', p_idempotency_key::text || ':specialist-2',
      jsonb_build_object(
        'channel', 'whatsapp', 'recipientRole', 'specialist',
        'recipientIndex', 2, 'recipient', btrim(p_second_specialist_phone),
        'body', btrim(p_specialist_note)
      )
    ) returning id into v_second_outbox_id;
  end if;

  v_response := v_response || jsonb_build_object(
    'secondSpecialistId', p_second_specialist_id,
    'secondSpecialistOutboxId', v_second_outbox_id
  );
  update public.command_receipts
  set response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

revoke all on function public.kiara_command_prepare_order_dispatch_v2(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, uuid, text,
  numeric, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.kiara_command_prepare_order_dispatch_v2(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, uuid, text,
  numeric, text, text, text, text, text, text, text, text
) to service_role;

create or replace function public.kiara_command_finish_order_dispatch_v2(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_command_id uuid,
  p_driver_sent boolean,
  p_specialist_sent boolean,
  p_second_specialist_sent boolean,
  p_driver_error text,
  p_specialist_error text,
  p_second_specialist_error text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_response jsonb;
begin
  v_response := public.kiara_command_finish_order_dispatch(
    p_restaurant_id, p_order_id, p_command_id, p_driver_sent,
    p_specialist_sent, p_driver_error, p_specialist_error
  );

  update public.outbox_events
  set status = case when p_second_specialist_sent then 'sent' else 'failed' end,
      completed_at = now(),
      last_error = nullif(p_second_specialist_error, '')
  where restaurant_id = p_restaurant_id
    and command_id = p_command_id
    and idempotency_key = p_command_id::text || ':specialist-2';

  v_response := v_response || jsonb_build_object(
    'secondSpecialistSent', p_second_specialist_sent
  );
  update public.command_receipts
  set response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_command_id;
  return v_response;
end;
$$;

revoke all on function public.kiara_command_finish_order_dispatch_v2(
  uuid, uuid, uuid, boolean, boolean, boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.kiara_command_finish_order_dispatch_v2(
  uuid, uuid, uuid, boolean, boolean, boolean, text, text, text
) to service_role;

-- The field command's state machine is unchanged; only its order-membership
-- predicate expands so either assigned specialist can perform specialist steps.
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
    and p.proname = 'kiara_command_field_order_step'
    and pg_get_function_identity_arguments(p.oid) =
      'p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_field_staff_account_id uuid, p_role text, p_roster_id uuid, p_action text, p_location jsonb';

  if v_oid is null then
    raise exception 'kiara_command_field_order_step was not found';
  end if;
  v_before := pg_get_functiondef(v_oid);
  v_after := replace(
    v_before,
    '(p_role = ''specialist'' and v_order.specialist_id is distinct from p_roster_id)',
    '(p_role = ''specialist'' and v_order.specialist_id is distinct from p_roster_id and v_order.second_specialist_id is distinct from p_roster_id)'
  );
  if v_after = v_before then
    raise exception 'field order specialist authorization predicate was not found';
  end if;
  execute v_after;
end;
$migration$;
