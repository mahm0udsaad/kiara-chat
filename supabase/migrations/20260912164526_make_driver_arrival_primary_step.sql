-- Make the driver's arrival at the specialist a real gate in the field
-- workflow. Older visits were allowed to skip this side event, so infer their
-- arrival from the specialist's pickup time before tightening the invariant.
begin;
alter table public.field_order_progress
  disable trigger reject_cancelled_field_progress_update;
update public.field_order_progress
set driver_arrived_at = specialist_pickup_at
where driver_arrived_at is null
  and specialist_pickup_at is not null;
alter table public.field_order_progress
  enable trigger reject_cancelled_field_progress_update;
commit;

alter table public.field_order_progress
  drop constraint if exists field_order_progress_sequence_check;
alter table public.field_order_progress
  add constraint field_order_progress_sequence_check check (
    (driver_arrived_at is null or driver_confirmed_at is not null)
    and (specialist_pickup_at is null or driver_arrived_at is not null)
    and (service_started_at is null or specialist_pickup_at is not null)
    and (completed_at is null or service_started_at is not null)
    and (driver_returned_at is null or completed_at is not null)
  );

-- Preserve the latest version of the command (including the two-specialist
-- authorization patch) and change only its state-machine clauses.
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
    'when v_progress.driver_confirmed_at is null then ''confirm_ride''
    when v_progress.specialist_pickup_at is null then ''confirm_pickup''',
    'when v_progress.driver_confirmed_at is null then ''confirm_ride''
    when v_progress.driver_arrived_at is null then ''driver_arrived''
    when v_progress.specialist_pickup_at is null then ''confirm_pickup'''
  );
  if v_after = v_before then
    raise exception 'field order expected-action chain was not found';
  end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    'if p_action = ''driver_arrived'' then
    -- A side event, not part of the linear chain: valid only between the
    -- driver confirming the ride and the specialist getting in the car, and
    -- only for the driver. It never blocks her next step.
    if p_role <> ''driver'' then
      raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_FORBIDDEN'';
    end if;
    if v_progress.driver_confirmed_at is null
      or v_progress.specialist_pickup_at is not null then
      raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_OUT_OF_SEQUENCE'';
    end if;
  else
    if v_expected_action is distinct from p_action then
      raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_OUT_OF_SEQUENCE'';
    end if;
    if (p_action in (''confirm_ride'', ''driver_return'') and p_role <> ''driver'')
      or (p_action in (''confirm_pickup'', ''start_service'', ''complete_order'')
          and p_role <> ''specialist'') then
      raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_FORBIDDEN'';
    end if;
  end if;',
    'if v_expected_action is distinct from p_action then
    raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_OUT_OF_SEQUENCE'';
  end if;
  if (p_action in (''confirm_ride'', ''driver_arrived'', ''driver_return'') and p_role <> ''driver'')
    or (p_action in (''confirm_pickup'', ''start_service'', ''complete_order'')
        and p_role <> ''specialist'') then
    raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_FORBIDDEN'';
  end if;'
  );
  -- Some production databases have the same command body without the
  -- explanatory comment that appeared in the development migration. Match
  -- that equivalent form as a fallback while keeping the resulting logic
  -- identical.
  if v_after = v_before then
    v_after := replace(
      v_before,
      'if p_action = ''driver_arrived'' then
    if p_role <> ''driver'' then
      raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_FORBIDDEN'';
    end if;
    if v_progress.driver_confirmed_at is null
      or v_progress.specialist_pickup_at is not null then
      raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_OUT_OF_SEQUENCE'';
    end if;
  else
    if v_expected_action is distinct from p_action then
      raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_OUT_OF_SEQUENCE'';
    end if;
    if (p_action in (''confirm_ride'', ''driver_return'') and p_role <> ''driver'')
      or (p_action in (''confirm_pickup'', ''start_service'', ''complete_order'')
          and p_role <> ''specialist'') then
      raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_FORBIDDEN'';
    end if;
  end if;',
      'if v_expected_action is distinct from p_action then
    raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_OUT_OF_SEQUENCE'';
  end if;
  if (p_action in (''confirm_ride'', ''driver_arrived'', ''driver_return'') and p_role <> ''driver'')
    or (p_action in (''confirm_pickup'', ''start_service'', ''complete_order'')
        and p_role <> ''specialist'') then
    raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_FORBIDDEN'';
  end if;'
    );
  end if;
  if v_after = v_before then
    raise exception 'field order arrival side-event validation was not found';
  end if;

  execute v_after;
end;
$migration$;
