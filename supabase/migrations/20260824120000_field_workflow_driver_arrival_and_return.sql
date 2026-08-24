-- Field workflow: a driver "I've arrived" ping and a driver return-trip close-out.
--
-- Two changes to the specialist/driver visit flow:
--   1. driver_arrived — a NON-blocking ping. After the driver confirms the ride
--      he can announce he reached the specialist. It records a timestamp and
--      lets the app notify her, but it does NOT gate her pickup: she can still
--      confirm she is in the car whether or not he tapped it.
--   2. driver_return — a new LINEAR closing step owned by the driver, after the
--      specialist finishes the service. The service ending (complete_order)
--      still resolves CS/billing exactly as before; driver_return is the
--      operational close-out that marks the visit fully done.
--
-- Resulting linear chain (each gates the next):
--   confirm_ride (driver) → confirm_pickup (specialist) → start_service
--   (specialist) → complete_order (specialist) → driver_return (driver)
-- with driver_arrived (driver) sitting beside it as a side event.

-- --------------------------------------------------------------- columns

alter table public.field_order_progress
  add column if not exists driver_arrived_at timestamptz,
  add column if not exists driver_returned_at timestamptz;

-- The visit is only "pending" now until the driver returns, not when the
-- specialist finishes — otherwise the driver's close-out step would never be
-- reminded. Repoint the reminder index at the true terminal column.
drop index if exists public.field_order_progress_pending_reminders_idx;
create index if not exists field_order_progress_pending_reminders_idx
  on public.field_order_progress (last_activity_at)
  where driver_returned_at is null;

-- Extend the ordering invariant: a return needs a completed service, and an
-- arrival ping needs a confirmed ride behind it.
alter table public.field_order_progress
  drop constraint if exists field_order_progress_sequence_check;
alter table public.field_order_progress
  add constraint field_order_progress_sequence_check check (
    (specialist_pickup_at is null or driver_confirmed_at is not null)
    and (service_started_at is null or specialist_pickup_at is not null)
    and (completed_at is null or service_started_at is not null)
    and (driver_returned_at is null or completed_at is not null)
    and (driver_arrived_at is null or driver_confirmed_at is not null)
  );

-- Location evidence may now be attached to the two new actions too.
alter table public.field_location_checkpoints
  drop constraint if exists field_location_checkpoints_action_check;
alter table public.field_location_checkpoints
  add constraint field_location_checkpoints_action_check
  check (action in (
    'confirm_ride', 'confirm_pickup', 'start_service', 'complete_order',
    'driver_arrived', 'driver_return'
  ));

-- --------------------------------------------------- step command (recreate)

create or replace function public.kiara_command_field_order_step(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_field_staff_account_id uuid,
  p_role text,
  p_roster_id uuid,
  p_action text,
  p_location jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_order public.driver_orders%rowtype;
  v_progress public.field_order_progress%rowtype;
  v_existing public.command_receipts%rowtype;
  v_response jsonb;
  v_expected_action text;
begin
  if p_role not in ('driver', 'specialist') then
    raise exception using errcode = 'P0001', message = 'FIELD_ROLE_INVALID';
  end if;
  if p_action not in (
    'confirm_ride', 'confirm_pickup', 'start_service', 'complete_order',
    'driver_arrived', 'driver_return'
  ) then
    raise exception using errcode = 'P0001', message = 'FIELD_ACTION_INVALID';
  end if;
  if not exists (
    select 1
    from public.field_staff_accounts a
    where a.id = p_field_staff_account_id
      and a.auth_user_id = p_actor_user_id
      and a.restaurant_id = p_restaurant_id
      and a.role = p_role
      and a.is_active = true
      and (
        (p_role = 'driver' and a.driver_id = p_roster_id)
        or (p_role = 'specialist' and a.specialist_id = p_roster_id)
      )
  ) then
    raise exception using errcode = 'P0001', message = 'FIELD_ACCOUNT_FORBIDDEN';
  end if;

  select * into v_order
  from public.driver_orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  if (p_role = 'driver' and v_order.driver_id is distinct from p_roster_id)
    or (p_role = 'specialist' and v_order.specialist_id is distinct from p_roster_id) then
    raise exception using errcode = 'P0001', message = 'FIELD_ORDER_FORBIDDEN';
  end if;

  insert into public.field_order_progress (order_id, restaurant_id)
  values (p_order_id, p_restaurant_id)
  on conflict (order_id) do nothing;

  select * into v_progress
  from public.field_order_progress
  where order_id = p_order_id and restaurant_id = p_restaurant_id
  for update;

  select * into v_existing
  from public.command_receipts
  where restaurant_id = p_restaurant_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.command_type <> 'field.order_step'
      or v_existing.aggregate_id <> p_order_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing.status = 'completed' then
      return v_existing.response || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'COMMAND_IN_PROGRESS';
  end if;

  if v_progress.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'FIELD_VERSION_CONFLICT',
      detail = jsonb_build_object('currentVersion', v_progress.version)::text;
  end if;

  -- The linear chain the reminders and UI advance through.
  v_expected_action := case
    when v_progress.driver_confirmed_at is null then 'confirm_ride'
    when v_progress.specialist_pickup_at is null then 'confirm_pickup'
    when v_progress.service_started_at is null then 'start_service'
    when v_progress.completed_at is null then 'complete_order'
    when v_progress.driver_returned_at is null then 'driver_return'
    else null
  end;

  if p_action = 'driver_arrived' then
    -- A side event, not part of the linear chain: valid only between the
    -- driver confirming the ride and the specialist getting in the car, and
    -- only for the driver. It never blocks her next step.
    if p_role <> 'driver' then
      raise exception using errcode = 'P0001', message = 'FIELD_ACTION_FORBIDDEN';
    end if;
    if v_progress.driver_confirmed_at is null
      or v_progress.specialist_pickup_at is not null then
      raise exception using errcode = 'P0001', message = 'FIELD_ACTION_OUT_OF_SEQUENCE';
    end if;
  else
    if v_expected_action is distinct from p_action then
      raise exception using errcode = 'P0001', message = 'FIELD_ACTION_OUT_OF_SEQUENCE';
    end if;
    if (p_action in ('confirm_ride', 'driver_return') and p_role <> 'driver')
      or (p_action in ('confirm_pickup', 'start_service', 'complete_order')
          and p_role <> 'specialist') then
      raise exception using errcode = 'P0001', message = 'FIELD_ACTION_FORBIDDEN';
    end if;
  end if;

  insert into public.command_receipts (
    restaurant_id, idempotency_key, command_type, aggregate_type,
    aggregate_id, actor_user_id, actor_field_staff_account_id
  ) values (
    p_restaurant_id, p_idempotency_key, 'field.order_step', 'driver_order',
    p_order_id, p_actor_user_id, p_field_staff_account_id
  );

  if p_action = 'confirm_ride' then
    update public.field_order_progress
    set driver_confirmed_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  elsif p_action = 'driver_arrived' then
    -- coalesce keeps the first arrival time if it is somehow re-sent.
    update public.field_order_progress
    set driver_arrived_at = coalesce(driver_arrived_at, now()), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  elsif p_action = 'confirm_pickup' then
    update public.field_order_progress
    set specialist_pickup_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  elsif p_action = 'start_service' then
    update public.field_order_progress
    set service_started_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  elsif p_action = 'complete_order' then
    update public.field_order_progress
    set completed_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  else
    update public.field_order_progress
    set driver_returned_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  end if;

  if p_location is not null then
    insert into public.field_location_checkpoints (
      restaurant_id, order_id, field_staff_account_id, action,
      latitude, longitude, accuracy_meters, captured_at, source,
      permission_state, exception_reason
    ) values (
      p_restaurant_id, p_order_id, p_field_staff_account_id, p_action,
      case when p_location ? 'latitude' then (p_location->>'latitude')::double precision end,
      case when p_location ? 'longitude' then (p_location->>'longitude')::double precision end,
      case when p_location ? 'accuracyMeters' then (p_location->>'accuracyMeters')::double precision end,
      case when p_location ? 'capturedAt' then (p_location->>'capturedAt')::timestamptz end,
      coalesce(nullif(p_location->>'source', ''), 'device'),
      nullif(p_location->>'permissionState', ''),
      nullif(p_location->>'exceptionReason', '')
    );
  end if;

  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, actor_user_id, actor_field_staff_account_id, idempotency_key, payload
  ) values (
    p_restaurant_id, 'driver_order', p_order_id, 'field.' || p_action,
    'field_staff', p_role, p_actor_user_id, p_field_staff_account_id, p_idempotency_key,
    jsonb_build_object(
      'role', p_role,
      'rosterId', p_roster_id,
      'version', v_progress.version,
      'hasLocationEvidence', p_location is not null
    )
  );

  v_response := jsonb_build_object(
    'progress', to_jsonb(v_progress),
    'replayed', false
  );
  update public.command_receipts
  set status = 'completed', response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

-- Signature is unchanged, so the existing service_role grant carries over;
-- re-affirm it defensively in case this migration is replayed on a fresh copy.
revoke all on function public.kiara_command_field_order_step(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.kiara_command_field_order_step(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, text, jsonb
) to service_role;

-- ------------------------------------------------ reminder job (recreate)

create or replace function kiara_private.enqueue_field_reminders()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  push_messages jsonb;
  reminded_order_ids uuid[];
  message_count integer := 0;
begin
  with due_orders as (
    select
      progress.order_id,
      progress.restaurant_id,
      progress.last_activity_at,
      orders.specialist_id,
      orders.driver_id,
      case
        when progress.driver_confirmed_at is null then 'driver'
        when progress.completed_at is null then 'specialist'
        else 'driver'
      end as target_role,
      case
        when progress.driver_confirmed_at is null then 'تأكيد الرحلة والانطلاق'
        when progress.specialist_pickup_at is null then 'ركوب الأخصائية مع السائق'
        when progress.service_started_at is null then 'بدء الخدمة عند العميلة'
        when progress.completed_at is null then 'إنهاء الخدمة والمغادرة'
        else 'إنهاء الرحلة والعودة'
      end as action_label
    from public.field_order_progress as progress
    inner join public.driver_orders as orders
      on orders.id = progress.order_id
     and orders.restaurant_id = progress.restaurant_id
    where progress.driver_returned_at is null
      and progress.last_activity_at <= now() - interval '30 minutes'
      and (
        progress.last_reminder_at is null
        or progress.last_reminder_at <= now() - interval '30 minutes'
      )
    order by progress.last_activity_at
    limit 100
  ),
  recipient_accounts as (
    select
      due.order_id,
      due.last_activity_at,
      due.action_label,
      accounts.id as account_id
    from due_orders as due
    inner join public.field_staff_accounts as accounts
      on accounts.restaurant_id = due.restaurant_id
     and accounts.role = due.target_role
     and accounts.is_active = true
     and (
       (due.target_role = 'driver' and accounts.driver_id = due.driver_id)
       or
       (due.target_role = 'specialist' and accounts.specialist_id = due.specialist_id)
     )
    where
      (
        due.target_role = 'driver'
        and exists (
          select 1
          from public.drivers as drivers
          where drivers.id = due.driver_id
            and drivers.restaurant_id = due.restaurant_id
            and drivers.is_active = true
        )
      )
      or
      (
        due.target_role = 'specialist'
        and exists (
          select 1
          from public.specialists as specialists
          where specialists.id = due.specialist_id
            and specialists.restaurant_id = due.restaurant_id
            and specialists.is_active = true
        )
      )
  ),
  message_rows as (
    select
      recipients.order_id,
      recipients.last_activity_at,
      tokens.expo_token,
      recipients.action_label
    from recipient_accounts as recipients
    inner join public.field_staff_push_tokens as tokens
      on tokens.field_staff_account_id = recipients.account_id
     and tokens.disabled = false
    order by recipients.last_activity_at
    limit 100
  )
  select
    jsonb_agg(
      jsonb_build_object(
        'to', messages.expo_token,
        'title', 'تذكير بالخطوة المطلوبة',
        'body', messages.action_label,
        'sound', 'default',
        'priority', 'high',
        'data', jsonb_build_object(
          'type', 'field_order',
          'orderId', messages.order_id::text,
          'url', '/field/orders/' || messages.order_id::text
        )
      )
    ),
    array_agg(distinct messages.order_id),
    count(*)::integer
  into push_messages, reminded_order_ids, message_count
  from message_rows as messages;

  if message_count = 0 then
    return 0;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object(
      'Accept', 'application/json',
      'Content-Type', 'application/json'
    ),
    body := push_messages,
    timeout_milliseconds := 10000
  );

  update public.field_order_progress
  set last_reminder_at = now()
  where order_id = any(reminded_order_ids);

  return message_count;
end;
$$;

revoke all on function kiara_private.enqueue_field_reminders()
  from public, anon, authenticated;
grant execute on function kiara_private.enqueue_field_reminders()
  to service_role;

-- Verification after applying (local harness, per project workflow):
--   \d+ public.field_order_progress   -- new columns + updated sequence check
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname = 'field_location_checkpoints_action_check';
--   select pg_get_functiondef('public.kiara_command_field_order_step(
--     uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, text, jsonb)'::regprocedure);
--   select kiara_private.enqueue_field_reminders();
