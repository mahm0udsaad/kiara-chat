-- Run field-staff inactivity reminders entirely inside Supabase.
-- pg_cron owns the five-minute schedule; pg_net queues a batched request to
-- the Expo Push API. No Vercel cron or application secret is involved.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists kiara_private;
revoke all on schema kiara_private from public, anon, authenticated;

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
        else 'specialist'
      end as target_role,
      case
        when progress.driver_confirmed_at is null then 'تأكيد الرحلة'
        when progress.specialist_pickup_at is null then 'بدء الطلب عند وصول السائق'
        when progress.service_started_at is null then 'بدء الخدمة عند منزل العميلة'
        else 'إنهاء الطلب عند مغادرة منزل العميلة'
      end as action_label
    from public.field_order_progress as progress
    inner join public.driver_orders as orders
      on orders.id = progress.order_id
     and orders.restaurant_id = progress.restaurant_id
    where progress.completed_at is null
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

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'kiara-field-reminders'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'kiara-field-reminders',
    '*/5 * * * *',
    $command$select kiara_private.enqueue_field_reminders();$command$
  );
end
$$;

-- Verification after applying:
-- select jobid, jobname, schedule, active
-- from cron.job
-- where jobname = 'kiara-field-reminders';
--
-- select kiara_private.enqueue_field_reminders();
--
-- select status, return_message, start_time, end_time
-- from cron.job_run_details
-- where jobid = (
--   select jobid from cron.job where jobname = 'kiara-field-reminders'
-- )
-- order by start_time desc
-- limit 10;
