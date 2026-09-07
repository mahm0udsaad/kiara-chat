-- Let the assigned driver cancel only in the short window after accepting the
-- ride and before the specialist confirms pickup. The command is atomic and
-- idempotent because mobile connectivity often causes retries.

create or replace function public.kiara_command_cancel_accepted_driver_order(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_field_staff_account_id uuid,
  p_driver_id uuid,
  p_reason text
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
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) not between 3 and 500 then
    raise exception using errcode = 'P0001', message = 'FIELD_CANCEL_REASON_INVALID';
  end if;
  if not exists (
    select 1
    from public.field_staff_accounts a
    where a.id = p_field_staff_account_id
      and a.auth_user_id = p_actor_user_id
      and a.restaurant_id = p_restaurant_id
      and a.role = 'driver'
      and a.driver_id = p_driver_id
      and a.is_active = true
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
  if v_order.driver_id is distinct from p_driver_id then
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
    if v_existing.command_type <> 'field.cancel_accepted_order'
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
  if v_order.status = 'cancelled'
    or v_progress.driver_confirmed_at is null
    or v_progress.specialist_pickup_at is not null then
    raise exception using errcode = 'P0001', message = 'FIELD_CANCEL_NOT_ALLOWED';
  end if;

  insert into public.command_receipts (
    restaurant_id, idempotency_key, command_type, aggregate_type,
    aggregate_id, actor_user_id, actor_field_staff_account_id
  ) values (
    p_restaurant_id, p_idempotency_key, 'field.cancel_accepted_order',
    'driver_order', p_order_id, p_actor_user_id, p_field_staff_account_id
  );

  update public.field_order_progress
  set last_activity_at = now(), last_reminder_at = null, version = version + 1
  where order_id = p_order_id and restaurant_id = p_restaurant_id
  returning * into v_progress;

  update public.driver_orders
  set status = 'cancelled',
      dispatch_state = 'cancelled',
      active_dispatch_command_id = null,
      updated_at = now(),
      version = version + 1
  where id = p_order_id and restaurant_id = p_restaurant_id
  returning * into v_order;

  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, actor_user_id, actor_field_staff_account_id, idempotency_key, payload
  ) values (
    p_restaurant_id, 'driver_order', p_order_id, 'field.cancelled_by_driver',
    'field_staff', 'driver', p_actor_user_id, p_field_staff_account_id,
    p_idempotency_key,
    jsonb_build_object('driverId', p_driver_id, 'reason', v_reason, 'version', v_progress.version)
  );

  v_response := jsonb_build_object(
    'cancelled', true,
    'progress', to_jsonb(v_progress),
    'orderVersion', v_order.version,
    'replayed', false
  );
  update public.command_receipts
  set status = 'completed', response = v_response, updated_at = now()
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function public.kiara_command_cancel_accepted_driver_order(
  uuid, uuid, bigint, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.kiara_command_cancel_accepted_driver_order(
  uuid, uuid, bigint, uuid, uuid, uuid, uuid, text
) to service_role;

-- All field-step writers update this row, so this guard closes the race for
-- both driver cancellations and cancellations performed by operations staff.
create or replace function public.reject_cancelled_field_progress_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.driver_orders o
    where o.id = new.order_id
      and o.restaurant_id = new.restaurant_id
      and o.status = 'cancelled'
  ) then
    raise exception using errcode = 'P0001', message = 'FIELD_CANCEL_NOT_ALLOWED';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_cancelled_field_progress_update
  on public.field_order_progress;
create trigger reject_cancelled_field_progress_update
before update on public.field_order_progress
for each row execute function public.reject_cancelled_field_progress_update();

revoke all on function public.reject_cancelled_field_progress_update()
  from public, anon, authenticated;
grant execute on function public.reject_cancelled_field_progress_update()
  to service_role;

-- Cancelled orders must never enter the reminder queue. Keeping this guard in
-- the query also fixes admin-cancelled orders created before this command.
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
      and orders.status <> 'cancelled'
      and progress.last_activity_at <= now() - interval '30 minutes'
      and (
        progress.last_reminder_at is null
        or progress.last_reminder_at <= now() - interval '30 minutes'
      )
    order by progress.last_activity_at
    limit 100
  ),
  recipient_accounts as (
    select due.order_id, due.last_activity_at, due.action_label, accounts.id as account_id
    from due_orders as due
    inner join public.field_staff_accounts as accounts
      on accounts.restaurant_id = due.restaurant_id
     and accounts.role = due.target_role
     and accounts.is_active = true
     and ((due.target_role = 'driver' and accounts.driver_id = due.driver_id)
       or (due.target_role = 'specialist' and accounts.specialist_id = due.specialist_id))
    where (due.target_role = 'driver' and exists (
      select 1 from public.drivers d where d.id = due.driver_id
        and d.restaurant_id = due.restaurant_id and d.is_active = true
    )) or (due.target_role = 'specialist' and exists (
      select 1 from public.specialists s where s.id = due.specialist_id
        and s.restaurant_id = due.restaurant_id and s.is_active = true
    ))
  ),
  message_rows as (
    select recipients.order_id, recipients.last_activity_at,
      tokens.expo_token, recipients.action_label
    from recipient_accounts recipients
    inner join public.field_staff_push_tokens tokens
      on tokens.field_staff_account_id = recipients.account_id
     and tokens.disabled = false
    order by recipients.last_activity_at
    limit 100
  )
  select jsonb_agg(jsonb_build_object(
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
    )), array_agg(distinct messages.order_id), count(*)::integer
  into push_messages, reminded_order_ids, message_count
  from message_rows messages;

  if message_count = 0 then return 0; end if;
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object('Accept', 'application/json', 'Content-Type', 'application/json'),
    body := push_messages,
    timeout_milliseconds := 10000
  );
  update public.field_order_progress
  set last_reminder_at = now()
  where order_id = any(reminded_order_ids);
  return message_count;
end;
$$;

revoke all on function kiara_private.enqueue_field_reminders() from public, anon, authenticated;
grant execute on function kiara_private.enqueue_field_reminders() to service_role;
