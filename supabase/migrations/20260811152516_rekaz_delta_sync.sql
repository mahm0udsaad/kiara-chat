-- Normalized, auditable Rekaz projection. The legacy Storage snapshot remains
-- a temporary read-model compatibility layer while mobile/web screens move to
-- these rows.

create table if not exists public.rekaz_sync_runs (
  id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  source text not null default 'rekaz' check (source = 'rekaz'),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  actor_user_id uuid,
  actor_team_member_id uuid references public.team_members(id) on delete set null,
  incoming_count integer not null default 0,
  added_count integer not null default 0,
  updated_count integer not null default 0,
  removed_count integer not null default 0,
  unchanged_count integer not null default 0,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (restaurant_id, id)
);

create index if not exists rekaz_sync_runs_tenant_started_idx
  on public.rekaz_sync_runs (restaurant_id, started_at desc);

create table if not exists public.rekaz_reservations (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  source_id text not null,
  source_order_id text,
  payload_hash text not null,
  arrival_at timestamptz not null,
  customer_phone text not null,
  customer_name text not null default '',
  status text not null default '',
  payload jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  last_sync_run_id uuid references public.rekaz_sync_runs(id) on delete set null,
  primary key (restaurant_id, source_id)
);

create index if not exists rekaz_reservations_calendar_idx
  on public.rekaz_reservations (restaurant_id, arrival_at)
  where removed_at is null;

create index if not exists rekaz_reservations_customer_idx
  on public.rekaz_reservations (restaurant_id, customer_phone, arrival_at desc);

create table if not exists public.rekaz_changes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  sync_run_id uuid not null references public.rekaz_sync_runs(id) on delete cascade,
  source_id text not null,
  change_type text not null
    check (change_type in ('added', 'updated', 'removed', 'restored')),
  previous_payload jsonb,
  next_payload jsonb,
  changed_at timestamptz not null default now(),
  unique (sync_run_id, source_id, change_type)
);

create index if not exists rekaz_changes_tenant_timeline_idx
  on public.rekaz_changes (restaurant_id, changed_at desc);

alter table public.rekaz_sync_runs enable row level security;
alter table public.rekaz_reservations enable row level security;
alter table public.rekaz_changes enable row level security;

revoke all on table public.rekaz_sync_runs from public, anon, authenticated;
revoke all on table public.rekaz_reservations from public, anon, authenticated;
revoke all on table public.rekaz_changes from public, anon, authenticated;

grant select, insert, update, delete on table public.rekaz_sync_runs to service_role;
grant select, insert, update, delete on table public.rekaz_reservations to service_role;
grant select, insert, update, delete on table public.rekaz_changes to service_role;

-- `p_window_start`/`p_window_end` are the bounds the Rekaz adapter actually
-- fetched. Absence from `p_rows` only counts as a removal INSIDE that window:
-- the adapter reads a rolling range (yesterday .. +60 days), so without this
-- bound every sync would tombstone the previous day's reservations and invent
-- a removal in the pending banner and the change history.
create or replace function public.kiara_apply_rekaz_snapshot(
  p_restaurant_id uuid,
  p_sync_run_id uuid,
  p_actor_user_id uuid,
  p_actor_team_member_id uuid,
  p_rows jsonb,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_run public.rekaz_sync_runs%rowtype;
  v_incoming integer;
  v_added integer;
  v_updated integer;
  v_removed integer;
  v_unchanged integer;
  v_actor_type text;
  v_response jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = 'P0001', message = 'REKAZ_SNAPSHOT_INVALID';
  end if;
  if p_window_start is null or p_window_end is null
    or p_window_end <= p_window_start then
    raise exception using errcode = 'P0001', message = 'REKAZ_WINDOW_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming("arrivalAt" timestamptz)
    where incoming."arrivalAt" < p_window_start
       or incoming."arrivalAt" > p_window_end
  ) then
    raise exception using errcode = 'P0001', message = 'REKAZ_ROW_OUTSIDE_WINDOW';
  end if;

  -- One apply per tenant. The lock is transaction-scoped and automatically
  -- released on success or rollback.
  perform pg_advisory_xact_lock(hashtextextended('kiara:rekaz:' || p_restaurant_id::text, 0));

  select * into v_run
  from public.rekaz_sync_runs
  where id = p_sync_run_id and restaurant_id = p_restaurant_id;
  if found then
    if v_run.status = 'completed' then
      return jsonb_build_object(
        'syncRunId', v_run.id,
        'incoming', v_run.incoming_count,
        'added', v_run.added_count,
        'updated', v_run.updated_count,
        'removed', v_run.removed_count,
        'unchanged', v_run.unchanged_count,
        'replayed', true
      );
    end if;
    raise exception using errcode = 'P0001', message = 'REKAZ_SYNC_IN_PROGRESS';
  end if;

  select count(*) into v_incoming
  from jsonb_to_recordset(p_rows) as incoming(
    "sourceId" text,
    "sourceOrderId" text,
    "payloadHash" text,
    "arrivalAt" timestamptz,
    "customerPhone" text,
    "customerName" text,
    status text,
    payload jsonb
  );

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming(
      "sourceId" text,
      "sourceOrderId" text,
      "payloadHash" text,
      "arrivalAt" timestamptz,
      "customerPhone" text,
      "customerName" text,
      status text,
      payload jsonb
    )
    group by incoming."sourceId"
    having incoming."sourceId" is null or count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'REKAZ_SOURCE_ID_DUPLICATE';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming(
      "sourceId" text,
      "sourceOrderId" text,
      "payloadHash" text,
      "arrivalAt" timestamptz,
      "customerPhone" text,
      "customerName" text,
      status text,
      payload jsonb
    )
    where nullif(btrim(incoming."sourceId"), '') is null
      or nullif(btrim(incoming."payloadHash"), '') is null
      or incoming."arrivalAt" is null
      or incoming.payload is null
  ) then
    raise exception using errcode = 'P0001', message = 'REKAZ_ROW_INVALID';
  end if;

  insert into public.rekaz_sync_runs (
    id, restaurant_id, actor_user_id, actor_team_member_id, incoming_count
  ) values (
    p_sync_run_id, p_restaurant_id, p_actor_user_id, p_actor_team_member_id, v_incoming
  );

  insert into public.rekaz_changes (
    restaurant_id, sync_run_id, source_id, change_type,
    previous_payload, next_payload
  )
  select
    p_restaurant_id,
    p_sync_run_id,
    incoming."sourceId",
    case
      when existing.source_id is null then 'added'
      when existing.removed_at is not null then 'restored'
      else 'updated'
    end,
    existing.payload,
    incoming.payload
  from jsonb_to_recordset(p_rows) as incoming(
    "sourceId" text,
    "sourceOrderId" text,
    "payloadHash" text,
    "arrivalAt" timestamptz,
    "customerPhone" text,
    "customerName" text,
    status text,
    payload jsonb
  )
  left join public.rekaz_reservations existing
    on existing.restaurant_id = p_restaurant_id
   and existing.source_id = incoming."sourceId"
  where existing.source_id is null
     or existing.removed_at is not null
     or existing.payload_hash is distinct from incoming."payloadHash";

  insert into public.rekaz_changes (
    restaurant_id, sync_run_id, source_id, change_type,
    previous_payload, next_payload
  )
  select
    p_restaurant_id,
    p_sync_run_id,
    existing.source_id,
    'removed',
    existing.payload,
    null
  from public.rekaz_reservations existing
  where existing.restaurant_id = p_restaurant_id
    and existing.removed_at is null
    and existing.arrival_at between p_window_start and p_window_end
    and not exists (
      select 1
      from jsonb_to_recordset(p_rows) as incoming(
        "sourceId" text,
        "sourceOrderId" text,
        "payloadHash" text,
        "arrivalAt" timestamptz,
        "customerPhone" text,
        "customerName" text,
        status text,
        payload jsonb
      )
      where incoming."sourceId" = existing.source_id
    );

  insert into public.rekaz_reservations (
    restaurant_id, source_id, source_order_id, payload_hash, arrival_at,
    customer_phone, customer_name, status, payload, last_seen_at,
    removed_at, last_sync_run_id
  )
  select
    p_restaurant_id,
    incoming."sourceId",
    nullif(incoming."sourceOrderId", ''),
    incoming."payloadHash",
    incoming."arrivalAt",
    coalesce(incoming."customerPhone", ''),
    coalesce(incoming."customerName", ''),
    coalesce(incoming.status, ''),
    incoming.payload,
    now(),
    null,
    p_sync_run_id
  from jsonb_to_recordset(p_rows) as incoming(
    "sourceId" text,
    "sourceOrderId" text,
    "payloadHash" text,
    "arrivalAt" timestamptz,
    "customerPhone" text,
    "customerName" text,
    status text,
    payload jsonb
  )
  on conflict (restaurant_id, source_id) do update
  set source_order_id = excluded.source_order_id,
      payload_hash = excluded.payload_hash,
      arrival_at = excluded.arrival_at,
      customer_phone = excluded.customer_phone,
      customer_name = excluded.customer_name,
      status = excluded.status,
      payload = excluded.payload,
      last_seen_at = now(),
      removed_at = null,
      last_sync_run_id = p_sync_run_id;

  update public.rekaz_reservations existing
  set removed_at = now(),
      last_sync_run_id = p_sync_run_id
  where existing.restaurant_id = p_restaurant_id
    and existing.removed_at is null
    and existing.arrival_at between p_window_start and p_window_end
    and not exists (
      select 1
      from jsonb_to_recordset(p_rows) as incoming(
        "sourceId" text,
        "sourceOrderId" text,
        "payloadHash" text,
        "arrivalAt" timestamptz,
        "customerPhone" text,
        "customerName" text,
        status text,
        payload jsonb
      )
      where incoming."sourceId" = existing.source_id
    );

  select
    count(*) filter (where change_type = 'added'),
    count(*) filter (where change_type in ('updated', 'restored')),
    count(*) filter (where change_type = 'removed')
  into v_added, v_updated, v_removed
  from public.rekaz_changes
  where sync_run_id = p_sync_run_id;

  v_unchanged := greatest(v_incoming - v_added - v_updated, 0);
  update public.rekaz_sync_runs
  set status = 'completed',
      added_count = v_added,
      updated_count = v_updated,
      removed_count = v_removed,
      unchanged_count = v_unchanged,
      completed_at = now()
  where id = p_sync_run_id
  returning * into v_run;

  v_actor_type := case when p_actor_team_member_id is null then 'owner' else 'team_member' end;
  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, actor_user_id, actor_team_member_id, idempotency_key, payload
  ) values (
    p_restaurant_id, 'rekaz_sync', p_sync_run_id, 'rekaz.sync_completed',
    v_actor_type, p_actor_role, p_actor_user_id, p_actor_team_member_id, p_sync_run_id,
    jsonb_build_object(
      'incoming', v_incoming,
      'added', v_added,
      'updated', v_updated,
      'removed', v_removed,
      'unchanged', v_unchanged
    )
  );

  v_response := jsonb_build_object(
    'syncRunId', p_sync_run_id,
    'incoming', v_incoming,
    'added', v_added,
    'updated', v_updated,
    'removed', v_removed,
    'unchanged', v_unchanged,
    'replayed', false
  );
  return v_response;
end;
$$;

revoke all on function public.kiara_apply_rekaz_snapshot(
  uuid, uuid, uuid, uuid, jsonb, timestamptz, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.kiara_apply_rekaz_snapshot(
  uuid, uuid, uuid, uuid, jsonb, timestamptz, timestamptz, text
) to service_role;

-- Verification after applying in staging:
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public' and tablename like 'rekaz_%';
--
-- select grantee, routine_name
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name = 'kiara_apply_rekaz_snapshot';
