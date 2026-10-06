-- A one-way outbound driver may hand the specialist's return to another
-- driver. Each leg keeps its own assignee and fare while sharing the visit's
-- service progress.
alter table public.driver_orders
  add column if not exists return_driver_id uuid references public.drivers(id) on delete set null,
  add column if not exists return_price numeric(10,2);

alter table public.driver_orders
  drop constraint if exists driver_orders_return_driver_shape_check;
alter table public.driver_orders
  add constraint driver_orders_return_driver_shape_check check (
    (return_driver_id is null or trip_type = 'one_way')
    and (return_driver_id is null or return_driver_id is distinct from driver_id)
    and (return_price is null or return_driver_id is not null)
    and (return_price is null or return_price >= 0)
  );

create index if not exists driver_orders_return_driver_schedule_idx
  on public.driver_orders (restaurant_id, return_driver_id, arrival_at)
  where return_driver_id is not null;

-- Extend the existing optimistic, audited order-update command rather than
-- creating an unaudited side write for the return assignment and fare.
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
  -- The production project may receive this file after it was applied once
  -- through SQL Editor. In that case there is nothing left to rewrite; the
  -- migration runner only needs to record the version.
  if position('returnDriverId' in v_before) > 0
    and position('returnPrice' in v_before) > 0
    and position('doorPhotoPath' in v_before) > 0 then
    return;
  end if;

  v_after := replace(
    v_before,
    '''specialistId'', ''driverId'', ''price''',
    '''specialistId'', ''driverId'', ''returnDriverId'', ''price'', ''returnPrice'', ''doorPhotoPath'''
  );
  if v_after = v_before then raise exception 'order patch allow-list was not found'; end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    'if p_patch ? ''price'' and p_actor_role <> ''admin'' then',
    'if (p_patch ? ''price'' or p_patch ? ''returnPrice'') and p_actor_role <> ''admin'' then'
  );
  if v_after = v_before then raise exception 'order price guard was not found'; end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    '  insert into public.command_receipts (',
    '  if p_patch ? ''returnDriverId''
    and nullif(p_patch->>''returnDriverId'', '''') is not null
    and not exists (
      select 1 from public.drivers
      where id = (p_patch->>''returnDriverId'')::uuid
        and restaurant_id = p_restaurant_id
        and is_active = true
    ) then
    raise exception using errcode = ''P0001'', message = ''RETURN_DRIVER_NOT_AVAILABLE'';
  end if;
  if coalesce(
      nullif(p_patch->>''returnDriverId'', '''')::uuid,
      case when not (p_patch ? ''returnDriverId'') then v_order.return_driver_id end
    ) is not null
    and coalesce(
      nullif(p_patch->>''returnDriverId'', '''')::uuid,
      case when not (p_patch ? ''returnDriverId'') then v_order.return_driver_id end
    ) = coalesce(nullif(p_patch->>''driverId'', '''')::uuid, v_order.driver_id) then
    raise exception using errcode = ''P0001'', message = ''RETURN_DRIVER_MUST_DIFFER'';
  end if;
  if p_patch ? ''returnPrice''
    and nullif(p_patch->>''returnPrice'', '''') is not null
    and (p_patch->>''returnPrice'')::numeric < 0 then
    raise exception using errcode = ''P0001'', message = ''ORDER_RETURN_PRICE_INVALID'';
  end if;

  insert into public.command_receipts ('
  );
  if v_after = v_before then raise exception 'order receipt insertion point was not found'; end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    '    driver_id = case when p_patch ? ''driverId''
      then nullif(p_patch->>''driverId'', '''')::uuid else driver_id end,
    price = case when p_patch ? ''price''
      then (p_patch->>''price'')::numeric else price end,',
    '    driver_id = case when p_patch ? ''driverId''
      then nullif(p_patch->>''driverId'', '''')::uuid else driver_id end,
    return_driver_id = case
      when p_patch ? ''returnDriverId'' then nullif(p_patch->>''returnDriverId'', '''')::uuid
      when p_patch->>''tripType'' = ''round_trip'' then null
      else return_driver_id
    end,
    price = case when p_patch ? ''price''
      then (p_patch->>''price'')::numeric else price end,
    return_price = case
      when p_patch ? ''returnPrice'' then (p_patch->>''returnPrice'')::numeric
      when (p_patch ? ''returnDriverId'' and nullif(p_patch->>''returnDriverId'', '''') is null)
        or p_patch->>''tripType'' = ''round_trip'' then null
      else return_price
    end,
    door_photo_path = case when p_patch ? ''doorPhotoPath''
      then nullif(p_patch->>''doorPhotoPath'', '''') else door_photo_path end,'
  );
  if v_after = v_before then raise exception 'order assignee update block was not found'; end if;

  execute v_after;
end;
$migration$;

-- Automatic reminders follow the same ownership rule. Before service
-- completion they target the outbound driver; afterwards they target the
-- assigned return driver. A one-way visit with no return assignment is done
-- at the customer's home and must not remain in the reminder queue forever.
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
  if v_oid is null then raise exception 'enqueue_field_reminders was not found'; end if;
  v_before := pg_get_functiondef(v_oid);
  if position('target_driver_id' in v_before) > 0 then return; end if;

  v_after := replace(
    v_before,
    '      orders.driver_id,',
    '      orders.driver_id,
      case
        when progress.completed_at is not null then coalesce(
          orders.return_driver_id,
          case when orders.trip_type = ''round_trip'' then orders.driver_id end
        )
        else orders.driver_id
      end as target_driver_id,'
  );
  if v_after = v_before then raise exception 'field reminder driver projection was not found'; end if;

  v_before := v_after;
  v_after := replace(v_before, 'accounts.driver_id = due.driver_id', 'accounts.driver_id = due.target_driver_id');
  if v_after = v_before then raise exception 'field reminder account driver was not found'; end if;

  v_before := v_after;
  v_after := replace(v_before, 'd.id = due.driver_id', 'd.id = due.target_driver_id');
  if v_after = v_before then raise exception 'field reminder active driver was not found'; end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    '    where progress.driver_returned_at is null',
    '    where progress.driver_returned_at is null
      and (
        progress.completed_at is null
        or orders.trip_type = ''round_trip''
        or orders.return_driver_id is not null
      )'
  );
  if v_after = v_before then raise exception 'field reminder terminal filter was not found'; end if;

  execute v_after;
end;
$migration$;

-- Let either assigned driver read the order, while preserving strict action
-- ownership: outbound steps belong to driver_id and the one final return step
-- belongs to return_driver_id (or driver_id for an ordinary round trip).
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
  if v_oid is null then raise exception 'kiara_command_field_order_step was not found'; end if;
  v_before := pg_get_functiondef(v_oid);
  if position('v_order.return_driver_id' in v_before) > 0
    and position('FIELD_CANCEL_NOT_ALLOWED' in v_before) > 0 then
    return;
  end if;

  v_after := replace(
    v_before,
    'if (p_role = ''driver'' and v_order.driver_id is distinct from p_roster_id)
    or (p_role = ''specialist''',
    'if (p_role = ''driver''
      and v_order.driver_id is distinct from p_roster_id
      and v_order.return_driver_id is distinct from p_roster_id)
    or (p_role = ''specialist'''
  );
  if v_after = v_before then raise exception 'field order driver access guard was not found'; end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    '  insert into public.field_order_progress (order_id, restaurant_id)',
    '  if v_order.status = ''cancelled'' or v_order.dispatch_state = ''cancelled'' then
    raise exception using errcode = ''P0001'', message = ''FIELD_CANCEL_NOT_ALLOWED'';
  end if;

  insert into public.field_order_progress (order_id, restaurant_id)'
  );
  if v_after = v_before then raise exception 'field cancelled-order guard point was not found'; end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    'when v_progress.completed_at is null then ''complete_order''
    when v_progress.driver_returned_at is null then ''driver_return''',
    'when v_progress.completed_at is null then ''complete_order''
    when (v_order.trip_type = ''round_trip'' or v_order.return_driver_id is not null)
      and v_progress.driver_returned_at is null then ''driver_return'''
  );
  if v_after = v_before then raise exception 'field return action chain was not found'; end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    '  if (p_action in (''confirm_ride'', ''driver_arrived'', ''driver_client_arrived'', ''driver_return'') and p_role <> ''driver'')',
    '  if p_role = ''driver'' and p_action <> ''driver_return''
    and v_order.driver_id is distinct from p_roster_id then
    raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_FORBIDDEN'';
  end if;
  if p_role = ''driver'' and p_action = ''driver_return''
    and coalesce(
      v_order.return_driver_id,
      case when v_order.trip_type = ''round_trip'' then v_order.driver_id end
    ) is distinct from p_roster_id then
    raise exception using errcode = ''P0001'', message = ''FIELD_ACTION_FORBIDDEN'';
  end if;

  if (p_action in (''confirm_ride'', ''driver_arrived'', ''driver_client_arrived'', ''driver_return'') and p_role <> ''driver'')'
  );
  if v_after = v_before then raise exception 'field action ownership point was not found'; end if;

  execute v_after;
end;
$migration$;
