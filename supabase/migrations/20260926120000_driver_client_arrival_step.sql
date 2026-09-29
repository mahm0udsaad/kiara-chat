-- Require the driver to confirm arrival at the customer's home after the
-- specialist is picked up and before the specialist can start the service.
-- Existing visits inherit the service-start time so this migration never
-- invalidates or reopens work that is already underway or complete.
alter table public.field_order_progress
  add column if not exists driver_client_arrived_at timestamptz;

begin;
alter table public.field_order_progress
  disable trigger reject_cancelled_field_progress_update;
update public.field_order_progress
set driver_client_arrived_at = service_started_at
where driver_client_arrived_at is null
  and service_started_at is not null;
alter table public.field_order_progress
  enable trigger reject_cancelled_field_progress_update;
commit;

alter table public.field_order_progress
  drop constraint if exists field_order_progress_sequence_check;
alter table public.field_order_progress
  add constraint field_order_progress_sequence_check check (
    (driver_arrived_at is null or driver_confirmed_at is not null)
    and (specialist_pickup_at is null or driver_arrived_at is not null)
    and (driver_client_arrived_at is null or specialist_pickup_at is not null)
    and (service_started_at is null or driver_client_arrived_at is not null)
    and (completed_at is null or service_started_at is not null)
    and (driver_returned_at is null or completed_at is not null)
  );

alter table public.field_location_checkpoints
  drop constraint if exists field_location_checkpoints_action_check;
alter table public.field_location_checkpoints
  add constraint field_location_checkpoints_action_check check (action in (
    'confirm_ride', 'driver_arrived', 'confirm_pickup',
    'driver_client_arrived', 'start_service', 'complete_order', 'driver_return'
  ));

alter table public.order_punctuality
  drop constraint if exists order_punctuality_client_arrival_source_check;
alter table public.order_punctuality
  add constraint order_punctuality_client_arrival_source_check check (
    client_arrival_source in ('geofence', 'driver_step', 'service_start')
  );

-- Preserve the deployed command body (including two-specialist access and
-- idempotency handling) and modify only the state-machine clauses. Each
-- replacement is checked so schema drift fails the migration loudly.
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
    '''confirm_ride'', ''confirm_pickup'', ''start_service'', ''complete_order'',
    ''driver_arrived'', ''driver_return''',
    '''confirm_ride'', ''confirm_pickup'', ''start_service'', ''complete_order'',
    ''driver_arrived'', ''driver_client_arrived'', ''driver_return'''
  );
  if v_after = v_before then
    raise exception 'field action allow-list was not found';
  end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    'when v_progress.specialist_pickup_at is null then ''confirm_pickup''
    when v_progress.service_started_at is null then ''start_service''',
    'when v_progress.specialist_pickup_at is null then ''confirm_pickup''
    when v_progress.driver_client_arrived_at is null then ''driver_client_arrived''
    when v_progress.service_started_at is null then ''start_service'''
  );
  if v_after = v_before then
    raise exception 'field expected-action chain was not found';
  end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    '  end;

  if v_expected_action is distinct from p_action then',
    '  end;

  -- Rolling-deploy compatibility: an older specialist app only knows
  -- start_service. Its API request may use that action while this new driver
  -- checkpoint is pending, so use the service-start instant as fallback
  -- arrival evidence. Updated apps are gated by the API before this command.
  if p_action = ''start_service''
    and v_expected_action = ''driver_client_arrived''
    and p_role = ''specialist'' then
    update public.field_order_progress
    set driver_client_arrived_at = coalesce(driver_client_arrived_at, now())
    where order_id = p_order_id
    returning * into v_progress;
    v_expected_action := ''start_service'';
  end if;

  if v_expected_action is distinct from p_action then'
  );
  if v_after = v_before then
    raise exception 'field rolling-deploy compatibility point was not found';
  end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    'p_action in (''confirm_ride'', ''driver_arrived'', ''driver_return'')',
    'p_action in (''confirm_ride'', ''driver_arrived'', ''driver_client_arrived'', ''driver_return'')'
  );
  if v_after = v_before then
    raise exception 'field driver-role action list was not found';
  end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    'elsif p_action = ''start_service'' then
    update public.field_order_progress
    set service_started_at = now(), last_activity_at = now(),',
    'elsif p_action = ''driver_client_arrived'' then
    update public.field_order_progress
    set driver_client_arrived_at = coalesce(driver_client_arrived_at, now()),
        last_activity_at = now(), last_reminder_at = null,
        version = version + 1
    where order_id = p_order_id returning * into v_progress;
  elsif p_action = ''start_service'' then
    update public.field_order_progress
    set service_started_at = now(), last_activity_at = now(),'
  );
  if v_after = v_before then
    raise exception 'field progress update branch was not found';
  end if;

  execute v_after;
end;
$migration$;

-- Keep the automatic reminder recipient aligned with the seven-step chain.
do $migration$
declare
  v_oid oid;
  v_before text;
  v_after text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'kiara_private'
    and p.proname = 'enqueue_field_reminders'
    and pg_get_function_identity_arguments(p.oid) = '';

  if v_oid is null then
    raise exception 'enqueue_field_reminders was not found';
  end if;

  v_before := pg_get_functiondef(v_oid);
  v_after := replace(
    v_before,
    'case
        when progress.driver_confirmed_at is null then ''driver''
        when progress.completed_at is null then ''specialist''
        else ''driver''
      end as target_role,
      case
        when progress.driver_confirmed_at is null then ''تأكيد الرحلة والانطلاق''
        when progress.specialist_pickup_at is null then ''ركوب الأخصائية مع السائق''
        when progress.service_started_at is null then ''بدء الخدمة عند العميلة''
        when progress.completed_at is null then ''إنهاء الخدمة والمغادرة''
        else ''إنهاء الرحلة والعودة''
      end as action_label',
    'case
        when progress.driver_confirmed_at is null then ''driver''
        when progress.driver_arrived_at is null then ''driver''
        when progress.specialist_pickup_at is null then ''specialist''
        when progress.driver_client_arrived_at is null then ''driver''
        when progress.completed_at is null then ''specialist''
        else ''driver''
      end as target_role,
      case
        when progress.driver_confirmed_at is null then ''تأكيد الرحلة والانطلاق''
        when progress.driver_arrived_at is null then ''الوصول لمقر الأخصائية''
        when progress.specialist_pickup_at is null then ''ركوب الأخصائية مع السائق''
        when progress.driver_client_arrived_at is null then ''تأكيد الوصول إلى منزل العميلة''
        when progress.service_started_at is null then ''بدء الخدمة عند العميلة''
        when progress.completed_at is null then ''إنهاء الخدمة والمغادرة''
        else ''إنهاء الرحلة والعودة''
      end as action_label'
  );
  if v_after = v_before then
    raise exception 'field reminder state machine was not found';
  end if;

  execute v_after;
end;
$migration$;
