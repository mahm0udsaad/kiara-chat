-- Paste-and-run repair + verification for the dispatch migrations.
--
-- Safe to run whether or not 20260902200000 landed: the function is replaced
-- outright, so a second run changes nothing. Nothing is dropped, no data is
-- touched, and the last statement returns a table of checks.
--
-- The function being repaired is the one whose signature never changed, which
-- is exactly why it cannot be verified from outside the database: if
-- 20260902200000 was skipped while 20260903090000 succeeded (its
-- `drop ... if exists` on the older signature is a no-op), every dispatch would
-- still mark an order `failed` whenever the WhatsApp copy did not send — even
-- though the field team can see the order perfectly well in the app.

-- ---------------------------------------------------------------- repair ---

create or replace function public.kiara_command_finish_order_dispatch(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_command_id uuid,
  p_driver_sent boolean,
  p_specialist_sent boolean,
  p_driver_error text,
  p_specialist_error text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_order public.driver_orders%rowtype;
  v_receipt public.command_receipts%rowtype;
  v_response jsonb;
begin
  select * into v_order
  from public.driver_orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  select * into v_receipt
  from public.command_receipts
  where restaurant_id = p_restaurant_id
    and idempotency_key = p_command_id
    and command_type = 'order.dispatch'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'DISPATCH_COMMAND_NOT_FOUND';
  end if;
  if v_receipt.status = 'completed' then
    return v_receipt.response || jsonb_build_object('replayed', true);
  end if;
  if v_order.active_dispatch_command_id is distinct from p_command_id then
    raise exception using errcode = 'P0001', message = 'DISPATCH_COMMAND_MISMATCH';
  end if;

  -- The WhatsApp flags settle the outbox rows only.
  update public.outbox_events
  set status = case
        when payload->>'recipientRole' = 'driver' and p_driver_sent then 'sent'
        when payload->>'recipientRole' = 'specialist' and p_specialist_sent then 'sent'
        else 'failed'
      end,
      completed_at = now(),
      last_error = case
        when payload->>'recipientRole' = 'driver' then nullif(p_driver_error, '')
        else nullif(p_specialist_error, '')
      end
  where restaurant_id = p_restaurant_id
    and command_id = p_command_id
    and status in ('pending', 'processing');

  -- The order is `sent` because it was assigned, which cannot fail once the
  -- command commits. A WhatsApp outage must never mark an order failed that
  -- the field team can already see in the app.
  update public.driver_orders
  set status = 'sent',
      sent_at = coalesce(sent_at, now()),
      dispatch_state = 'sent',
      active_dispatch_command_id = null,
      dispatch_started_at = null,
      updated_at = now(),
      version = version + 1
  where id = p_order_id and restaurant_id = p_restaurant_id
  returning * into v_order;

  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, idempotency_key, payload
  ) values (
    p_restaurant_id, 'driver_order', p_order_id, 'order.dispatch_completed', 'system',
    'system', p_command_id,
    jsonb_build_object(
      'driverWhatsappSent', p_driver_sent,
      'specialistWhatsappSent', p_specialist_sent,
      'driverError', nullif(p_driver_error, ''),
      'specialistError', nullif(p_specialist_error, ''),
      'version', v_order.version
    )
  );

  v_response := jsonb_build_object(
    'order', to_jsonb(v_order),
    'commandId', p_command_id,
    'driverSent', p_driver_sent,
    'specialistSent', p_specialist_sent,
    'replayed', false
  );
  update public.command_receipts
  set status = 'completed', response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_command_id;

  return v_response;
end;
$$;

revoke all on function public.kiara_command_finish_order_dispatch(
  uuid, uuid, uuid, boolean, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.kiara_command_finish_order_dispatch(
  uuid, uuid, uuid, boolean, boolean, text, text
) to service_role;

-- ---------------------------------------------------------- verification ---
-- Every row should read PASS.

select check_name, case when passed then 'PASS' else 'FAIL' end as result, detail
from (
  select 'finish: order stays sent on WhatsApp failure' as check_name,
         pg_get_functiondef(p.oid) like '%driverWhatsappSent%' as passed,
         'the repair above guarantees this' as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'kiara_command_finish_order_dispatch'

  union all
  select 'prepare: exactly one signature',
         count(*) = 1,
         count(*)::text || ' definition(s)'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'kiara_command_prepare_order_dispatch'

  union all
  select 'prepare: takes the door photo + phones',
         bool_or(
           pg_get_function_identity_arguments(p.oid) like '%p_door_photo_path%'
           and pg_get_function_identity_arguments(p.oid) like '%p_driver_phone%'
           and pg_get_function_identity_arguments(p.oid) like '%p_customer_location%'
         ),
         'args present'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'kiara_command_prepare_order_dispatch'

  union all
  select 'prepare: queues the WhatsApp copies',
         bool_or(pg_get_functiondef(p.oid) like '%whatsapp.driver.dispatch%'),
         'outbox insert present'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'kiara_command_prepare_order_dispatch'

  union all
  select 'prepare: refuses a placeholder address',
         bool_or(pg_get_functiondef(p.oid) like '%ORDER_LOCATION_REQUIRED%'),
         'guard present'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'kiara_command_prepare_order_dispatch'

  union all
  select 'driver_orders: the four new columns',
         count(*) = 4,
         count(*)::text || ' of 4'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'driver_orders'
    and column_name in ('driver_note', 'specialist_note',
                        'specialist_voice_path', 'door_photo_path')

  union all
  select 'driver_orders: trip_type defaults to round_trip',
         bool_or(column_default like '%round_trip%'),
         coalesce(max(column_default), '(none)')
  from information_schema.columns
  where table_schema = 'public' and table_name = 'driver_orders'
    and column_name = 'trip_type'

  union all
  -- The owner always holds EXECUTE implicitly, so "service_role only" is not
  -- the rule. The rule is that no client role can call these directly: a
  -- dispatch must go through the API, which is what enforces who may act.
  select 'grants: no client role can call the commands',
         not bool_or(grantee in ('anon', 'authenticated', 'PUBLIC')),
         coalesce(string_agg(distinct grantee, ', '), '(none)')
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('kiara_command_prepare_order_dispatch',
                         'kiara_command_finish_order_dispatch')
) checks
order by check_name;
