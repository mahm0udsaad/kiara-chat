-- Make the driver's arrival at the customer a hard prerequisite for starting
-- service. The earlier rolling-deploy bridge let an old specialist app fill
-- both timestamps with one start_service action; that made the driver step
-- optional and erased the independent arrival evidence.
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
    '  -- Rolling-deploy compatibility: an older specialist app only knows
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

',
    ''
  );

  if v_after = v_before then
    raise exception 'legacy service-start compatibility block was not found';
  end if;

  execute v_after;
end;
$migration$;
