-- Kiara CRM operational truth.
--
-- Mobile and web clients still authenticate through the Next.js API. These
-- tables and command functions are deliberately service-role only so a client
-- cannot bypass assignment checks by calling PostgREST directly.

alter table public.driver_orders
  add column if not exists version bigint not null default 1,
  add column if not exists dispatch_state text not null default 'idle',
  add column if not exists active_dispatch_command_id uuid,
  add column if not exists dispatch_started_at timestamptz;

alter table public.field_order_progress
  add column if not exists version bigint not null default 1;

update public.driver_orders
set dispatch_state = case status
  when 'sent' then 'sent'
  when 'failed' then 'failed'
  else 'idle'
end
where dispatch_state = 'idle';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.driver_orders'::regclass
      and conname = 'driver_orders_dispatch_state_check'
  ) then
    alter table public.driver_orders
      add constraint driver_orders_dispatch_state_check
      check (dispatch_state in ('idle', 'processing', 'sent', 'failed', 'uncertain'));
  end if;
end
$$;

create unique index if not exists driver_orders_active_dispatch_command_key
  on public.driver_orders (active_dispatch_command_id)
  where active_dispatch_command_id is not null;

create table if not exists public.command_receipts (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  idempotency_key uuid not null,
  command_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  actor_user_id uuid,
  actor_team_member_id uuid references public.team_members(id) on delete set null,
  actor_field_staff_account_id uuid
    references public.field_staff_accounts(id) on delete set null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed')),
  response jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, idempotency_key)
);

create index if not exists command_receipts_aggregate_idx
  on public.command_receipts (restaurant_id, aggregate_type, aggregate_id, created_at desc);

create table if not exists public.operation_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  actor_type text not null
    check (actor_type in ('team_member', 'owner', 'field_staff', 'system')),
  -- The role the actor held AT THIS MOMENT, not the role they hold now.
  -- Without it a report has to join `team_members` as it currently stands to
  -- say "an admin did this", which silently re-attributes history whenever
  -- somebody is promoted, demoted or deactivated. `actor_type` cannot stand in
  -- for it: it only records whether a team-member id was supplied, so an admin
  -- and an agent both land as 'team_member'.
  actor_role text
    check (actor_role in ('admin', 'agent', 'driver', 'specialist', 'system')),
  actor_user_id uuid,
  actor_team_member_id uuid references public.team_members(id) on delete set null,
  actor_field_staff_account_id uuid
    references public.field_staff_accounts(id) on delete set null,
  idempotency_key uuid,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists operation_events_aggregate_timeline_idx
  on public.operation_events (restaurant_id, aggregate_type, aggregate_id, occurred_at desc);

create index if not exists operation_events_actor_timeline_idx
  on public.operation_events (restaurant_id, actor_team_member_id, occurred_at desc)
  where actor_team_member_id is not null;

create unique index if not exists operation_events_command_type_key
  on public.operation_events (restaurant_id, idempotency_key, event_type)
  where idempotency_key is not null;

create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  command_id uuid not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'uncertain')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_at timestamptz,
  completed_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, idempotency_key)
);

create index if not exists outbox_events_pending_idx
  on public.outbox_events (restaurant_id, created_at)
  where status = 'pending';

create table if not exists public.field_location_checkpoints (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.driver_orders(id) on delete cascade,
  field_staff_account_id uuid not null
    references public.field_staff_accounts(id) on delete restrict,
  action text not null
    check (action in ('confirm_ride', 'confirm_pickup', 'start_service', 'complete_order')),
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  captured_at timestamptz,
  received_at timestamptz not null default now(),
  source text not null default 'device'
    check (source in ('device', 'manual_exception')),
  permission_state text,
  exception_reason text,
  -- Written as a CASE, not as two OR'd conjunctions. A CHECK passes when it
  -- evaluates to NULL, so `source = 'manual_exception' and char_length(null)
  -- between 3 and 500` yields NULL and lets an unexplained exception — or a
  -- device fix with no coordinates — through as valid evidence. `source` is
  -- NOT NULL, so this form can only be true or false.
  constraint field_location_checkpoint_evidence_check check (
    case source
      when 'device' then
        latitude is not null and latitude between -90 and 90
        and longitude is not null and longitude between -180 and 180
        and accuracy_meters is not null and accuracy_meters >= 0
        and captured_at is not null
      when 'manual_exception' then
        exception_reason is not null
        and char_length(btrim(exception_reason)) between 3 and 500
      else false
    end
  )
);

create index if not exists field_location_checkpoints_order_idx
  on public.field_location_checkpoints (restaurant_id, order_id, received_at desc);

alter table public.command_receipts enable row level security;
alter table public.operation_events enable row level security;
alter table public.outbox_events enable row level security;
alter table public.field_location_checkpoints enable row level security;

revoke all on table public.command_receipts from public, anon, authenticated;
revoke all on table public.operation_events from public, anon, authenticated;
revoke all on table public.outbox_events from public, anon, authenticated;
revoke all on table public.field_location_checkpoints from public, anon, authenticated;

grant select, insert, update, delete on table public.command_receipts to service_role;
grant select, insert, update, delete on table public.operation_events to service_role;
grant select, insert, update, delete on table public.outbox_events to service_role;
grant select, insert, update, delete on table public.field_location_checkpoints to service_role;

create schema if not exists kiara_private;
revoke all on schema kiara_private from public, anon, authenticated;

create or replace function kiara_private.tg_touch_operational_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function kiara_private.tg_touch_operational_updated_at()
  from public, anon, authenticated;

drop trigger if exists touch_command_receipts_updated_at on public.command_receipts;
create trigger touch_command_receipts_updated_at
  before update on public.command_receipts
  for each row execute function kiara_private.tg_touch_operational_updated_at();

drop trigger if exists touch_outbox_events_updated_at on public.outbox_events;
create trigger touch_outbox_events_updated_at
  before update on public.outbox_events
  for each row execute function kiara_private.tg_touch_operational_updated_at();

create or replace function public.kiara_command_update_driver_order(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_actor_team_member_id uuid,
  p_actor_role text,
  p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_order public.driver_orders%rowtype;
  v_existing public.command_receipts%rowtype;
  v_response jsonb;
  v_actor_type text;
begin
  if p_actor_role not in ('admin', 'agent') then
    raise exception using errcode = 'P0001', message = 'ORDER_FORBIDDEN';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = 'P0001', message = 'ORDER_PATCH_INVALID';
  end if;
  if (p_patch - array[
    'arrivalAt', 'customerLocation', 'durationMinutes', 'tripType',
    'specialistId', 'driverId', 'price'
  ]) <> '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'ORDER_PATCH_INVALID';
  end if;
  if p_patch ? 'price' and p_actor_role <> 'admin' then
    raise exception using errcode = 'P0001', message = 'ORDER_PRICE_FORBIDDEN';
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
    if v_existing.command_type <> 'order.update'
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

  if p_patch ? 'durationMinutes'
    and ((p_patch->>'durationMinutes')::integer < 5
      or (p_patch->>'durationMinutes')::integer > 480) then
    raise exception using errcode = 'P0001', message = 'ORDER_DURATION_INVALID';
  end if;
  if p_patch ? 'tripType'
    and p_patch->>'tripType' not in ('one_way', 'round_trip') then
    raise exception using errcode = 'P0001', message = 'ORDER_TRIP_TYPE_INVALID';
  end if;
  if p_patch ? 'customerLocation'
    and char_length(btrim(p_patch->>'customerLocation')) < 2 then
    raise exception using errcode = 'P0001', message = 'ORDER_LOCATION_INVALID';
  end if;
  if p_patch ? 'specialistId'
    and nullif(p_patch->>'specialistId', '') is not null
    and not exists (
      select 1 from public.specialists
      where id = (p_patch->>'specialistId')::uuid
        and restaurant_id = p_restaurant_id
        and is_active = true
    ) then
    raise exception using errcode = 'P0001', message = 'SPECIALIST_NOT_AVAILABLE';
  end if;
  if p_patch ? 'driverId'
    and nullif(p_patch->>'driverId', '') is not null
    and not exists (
      select 1 from public.drivers
      where id = (p_patch->>'driverId')::uuid
        and restaurant_id = p_restaurant_id
        and is_active = true
    ) then
    raise exception using errcode = 'P0001', message = 'DRIVER_NOT_AVAILABLE';
  end if;

  insert into public.command_receipts (
    restaurant_id, idempotency_key, command_type, aggregate_type,
    aggregate_id, actor_user_id, actor_team_member_id
  ) values (
    p_restaurant_id, p_idempotency_key, 'order.update', 'driver_order',
    p_order_id, p_actor_user_id, p_actor_team_member_id
  );

  update public.driver_orders
  set
    arrival_at = case when p_patch ? 'arrivalAt'
      then (p_patch->>'arrivalAt')::timestamptz else arrival_at end,
    customer_location = case when p_patch ? 'customerLocation'
      then btrim(p_patch->>'customerLocation') else customer_location end,
    duration_minutes = case when p_patch ? 'durationMinutes'
      then (p_patch->>'durationMinutes')::integer else duration_minutes end,
    trip_type = case when p_patch ? 'tripType'
      then p_patch->>'tripType' else trip_type end,
    specialist_id = case when p_patch ? 'specialistId'
      then nullif(p_patch->>'specialistId', '')::uuid else specialist_id end,
    driver_id = case when p_patch ? 'driverId'
      then nullif(p_patch->>'driverId', '')::uuid else driver_id end,
    price = case when p_patch ? 'price'
      then (p_patch->>'price')::numeric else price end,
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
    p_restaurant_id, 'driver_order', p_order_id, 'order.updated', v_actor_type,
    p_actor_role, p_actor_user_id, p_actor_team_member_id, p_idempotency_key,
    jsonb_build_object('patch', p_patch, 'version', v_order.version)
  );

  v_response := jsonb_build_object('order', to_jsonb(v_order), 'replayed', false);
  update public.command_receipts
  set status = 'completed', response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

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
  p_driver_phone text,
  p_driver_message text,
  p_specialist_phone text,
  p_specialist_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_order public.driver_orders%rowtype;
  v_existing public.command_receipts%rowtype;
  v_driver_outbox_id uuid;
  v_specialist_outbox_id uuid;
  v_response jsonb;
  v_actor_type text;
begin
  if p_actor_role not in ('admin', 'agent') then
    raise exception using errcode = 'P0001', message = 'ORDER_FORBIDDEN';
  end if;
  if p_trip_type not in ('one_way', 'round_trip') then
    raise exception using errcode = 'P0001', message = 'ORDER_TRIP_TYPE_INVALID';
  end if;
  if char_length(btrim(coalesce(p_driver_phone, ''))) < 8
    or char_length(btrim(coalesce(p_driver_message, ''))) < 2 then
    raise exception using errcode = 'P0001', message = 'DRIVER_MESSAGE_INVALID';
  end if;
  if char_length(p_driver_message) > 3000
    or char_length(coalesce(p_specialist_message, '')) > 3000 then
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

  update public.driver_orders
  set specialist_id = p_specialist_id,
      driver_id = p_driver_id,
      trip_type = p_trip_type,
      price = p_price,
      dispatch_state = 'processing',
      active_dispatch_command_id = p_idempotency_key,
      dispatch_started_at = now(),
      updated_by = p_actor_team_member_id,
      updated_at = now(),
      version = version + 1
  where id = p_order_id and restaurant_id = p_restaurant_id
  returning * into v_order;

  insert into public.outbox_events (
    restaurant_id, command_id, aggregate_type, aggregate_id, event_type,
    idempotency_key, payload
  ) values (
    p_restaurant_id, p_idempotency_key, 'driver_order', p_order_id,
    'whatsapp.driver.dispatch', p_idempotency_key::text || ':driver',
    jsonb_build_object(
      'channel', 'whatsapp', 'recipientRole', 'driver',
      'recipient', btrim(p_driver_phone), 'body', p_driver_message
    )
  ) returning id into v_driver_outbox_id;

  if char_length(btrim(coalesce(p_specialist_phone, ''))) >= 8
    and char_length(btrim(coalesce(p_specialist_message, ''))) >= 2 then
    insert into public.outbox_events (
      restaurant_id, command_id, aggregate_type, aggregate_id, event_type,
      idempotency_key, payload
    ) values (
      p_restaurant_id, p_idempotency_key, 'driver_order', p_order_id,
      'whatsapp.specialist.dispatch', p_idempotency_key::text || ':specialist',
      jsonb_build_object(
        'channel', 'whatsapp', 'recipientRole', 'specialist',
        'recipient', btrim(p_specialist_phone), 'body', p_specialist_message
      )
    ) returning id into v_specialist_outbox_id;
  end if;

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
      'driverOutboxId', v_driver_outbox_id,
      'specialistOutboxId', v_specialist_outbox_id
    )
  );

  v_response := jsonb_build_object(
    'order', to_jsonb(v_order),
    'commandId', p_idempotency_key,
    'driverOutboxId', v_driver_outbox_id,
    'specialistOutboxId', v_specialist_outbox_id,
    'replayed', false
  );
  update public.command_receipts
  set response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

create or replace function public.kiara_claim_outbox_event(
  p_restaurant_id uuid,
  p_command_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_event public.outbox_events%rowtype;
begin
  select * into v_event
  from public.outbox_events
  where id = p_event_id
    and restaurant_id = p_restaurant_id
    and command_id = p_command_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OUTBOX_EVENT_NOT_FOUND';
  end if;

  if v_event.status <> 'pending' then
    return jsonb_build_object(
      'claimed', false,
      'status', v_event.status,
      'event', to_jsonb(v_event)
    );
  end if;

  update public.outbox_events
  set status = 'processing',
      attempt_count = attempt_count + 1,
      claimed_at = now()
  where id = p_event_id
  returning * into v_event;

  return jsonb_build_object('claimed', true, 'event', to_jsonb(v_event));
end;
$$;

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

  update public.driver_orders
  set status = case when p_driver_sent then 'sent' else 'failed' end,
      sent_at = case when p_driver_sent then now() else sent_at end,
      dispatch_state = case when p_driver_sent then 'sent' else 'failed' end,
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
      'driverSent', p_driver_sent,
      'specialistSent', p_specialist_sent,
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
  if p_action not in ('confirm_ride', 'confirm_pickup', 'start_service', 'complete_order') then
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

  v_expected_action := case
    when v_progress.driver_confirmed_at is null then 'confirm_ride'
    when v_progress.specialist_pickup_at is null then 'confirm_pickup'
    when v_progress.service_started_at is null then 'start_service'
    when v_progress.completed_at is null then 'complete_order'
    else null
  end;
  if v_expected_action is distinct from p_action then
    raise exception using errcode = 'P0001', message = 'FIELD_ACTION_OUT_OF_SEQUENCE';
  end if;
  if (p_action = 'confirm_ride' and p_role <> 'driver')
    or (p_action <> 'confirm_ride' and p_role <> 'specialist') then
    raise exception using errcode = 'P0001', message = 'FIELD_ACTION_FORBIDDEN';
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
  else
    update public.field_order_progress
    set completed_at = now(), last_activity_at = now(),
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

revoke all on function public.kiara_command_update_driver_order(
  uuid, uuid, bigint, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.kiara_command_prepare_order_dispatch(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, text,
  numeric, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.kiara_claim_outbox_event(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.kiara_command_finish_order_dispatch(
  uuid, uuid, uuid, boolean, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.kiara_command_field_order_step(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, text, jsonb
) from public, anon, authenticated;

grant execute on function public.kiara_command_update_driver_order(
  uuid, uuid, bigint, uuid, uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.kiara_command_prepare_order_dispatch(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, text,
  numeric, text, text, text, text
) to service_role;
grant execute on function public.kiara_claim_outbox_event(uuid, uuid, uuid)
  to service_role;
grant execute on function public.kiara_command_finish_order_dispatch(
  uuid, uuid, uuid, boolean, boolean, text, text
) to service_role;
grant execute on function public.kiara_command_field_order_step(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, text, jsonb
) to service_role;

-- Verification after applying in staging:
--
-- select column_name, data_type, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in ('driver_orders', 'field_order_progress')
--   and column_name in ('version', 'dispatch_state', 'active_dispatch_command_id');
--
-- select routine_name, security_type
-- from information_schema.routines
-- where routine_schema = 'public'
--   and routine_name like 'kiara_command_%';
--
-- select grantee, routine_name
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name like 'kiara_%'
-- order by routine_name, grantee;
