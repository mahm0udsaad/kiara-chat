-- Approved visit services are independent of the latest Rekaz snapshot.
create table public.order_visit_services (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  order_id uuid not null references public.driver_orders(id) on delete cascade,
  source_id text,
  source_payload jsonb,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  minutes integer not null check (minutes between 1 and 480),
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, source_id)
);
create index order_visit_services_order_idx on public.order_visit_services(restaurant_id, order_id);

create table public.order_service_previews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  order_id uuid not null references public.driver_orders(id) on delete cascade,
  actor_user_id uuid not null,
  expected_version bigint not null,
  progress_snapshot jsonb not null,
  payload jsonb not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  approved_at timestamptz
);
create table public.order_service_notifications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  order_id uuid not null references public.driver_orders(id) on delete cascade,
  preview_id uuid not null references public.order_service_previews(id),
  role text not null check (role in ('driver', 'specialist')),
  roster_id uuid not null,
  title text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','processing','accepted','failed')),
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  unique(preview_id, role)
);
create index order_service_notifications_queue_idx on public.order_service_notifications(status, updated_at);
create table public.order_service_dismissals (
  restaurant_id uuid not null references public.restaurants(id),
  order_id uuid not null references public.driver_orders(id) on delete cascade,
  source_id text not null,
  payload_hash text not null,
  primary key (restaurant_id, order_id, source_id, payload_hash)
);

alter table public.order_visit_services enable row level security;
alter table public.order_service_previews enable row level security;
alter table public.order_service_notifications enable row level security;
alter table public.order_service_dismissals enable row level security;
revoke all on public.order_visit_services, public.order_service_previews, public.order_service_notifications, public.order_service_dismissals from public, anon, authenticated;
grant select, insert, update, delete on public.order_visit_services, public.order_service_previews, public.order_service_notifications, public.order_service_dismissals to service_role;

-- Capture the services already included in a visit at creation time. The
-- trigger also prevents raising a second driver order for a linked addition.
create function public.kiara_capture_visit_services() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_source public.rekaz_reservations%rowtype;
begin
  if new.rekaz_source_id is null then return new; end if;
  if exists(select 1 from public.order_visit_services where restaurant_id = new.restaurant_id and source_id = new.rekaz_source_id and order_id <> new.id) then
    raise exception 'RESERVATION_ALREADY_LINKED';
  end if;
  select * into v_source from public.rekaz_reservations where restaurant_id = new.restaurant_id and source_id = new.rekaz_source_id;
  if not found then return new; end if;
  insert into public.order_visit_services(restaurant_id, order_id, source_id, source_payload, name, minutes, starts_at)
  select new.restaurant_id, new.id, r.source_id, r.payload,
    left(coalesce(nullif(r.payload->>'service',''),'خدمة'),300),
    greatest(1,least(480,coalesce((r.payload->>'durationMinutes')::integer,60))), r.arrival_at
  from public.rekaz_reservations r
  where r.restaurant_id = new.restaurant_id and r.removed_at is null and r.status <> 'Cancelled'
    and (r.source_id = new.rekaz_source_id or (r.source_order_id = v_source.source_order_id
      and (r.arrival_at at time zone 'Asia/Riyadh')::date = (new.arrival_at at time zone 'Asia/Riyadh')::date))
  ;
  return new;
end $$;
revoke all on function public.kiara_capture_visit_services() from public, anon, authenticated;
grant execute on function public.kiara_capture_visit_services() to service_role;
create trigger capture_visit_services after insert on public.driver_orders for each row execute function public.kiara_capture_visit_services();

-- Legacy orders: only reservations already seen when the order was created
-- are baseline services. Later reservations remain reviewable additions.
insert into public.order_visit_services(restaurant_id, order_id, source_id, source_payload, name, minutes, starts_at)
select distinct on (o.restaurant_id, r.source_id) o.restaurant_id, o.id, r.source_id, r.payload,
  left(coalesce(nullif(r.payload->>'service',''),'خدمة'),300),
  greatest(1,least(480,coalesce((r.payload->>'durationMinutes')::integer,60))), r.arrival_at
from public.driver_orders o
join public.rekaz_reservations anchor on anchor.restaurant_id=o.restaurant_id and anchor.source_id=o.rekaz_source_id
join public.rekaz_reservations r on r.restaurant_id=o.restaurant_id
  and (r.source_id=o.rekaz_source_id or (r.source_order_id=anchor.source_order_id
    and r.first_seen_at <= o.created_at and (r.arrival_at at time zone 'Asia/Riyadh')::date=(o.arrival_at at time zone 'Asia/Riyadh')::date))
where r.removed_at is null and r.status <> 'Cancelled'
order by o.restaurant_id, r.source_id, (r.source_id=o.rekaz_source_id) desc, o.created_at
on conflict do nothing;

create function public.kiara_approve_service_change(p_restaurant_id uuid, p_order_id uuid, p_preview_id uuid,
  p_actor_user_id uuid, p_actor_team_member_id uuid, p_actor_role text, p_specialist_message text, p_driver_message text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  o public.driver_orders%rowtype;
  v public.order_service_previews%rowtype;
  r public.rekaz_reservations%rowtype;
  progress jsonb;
  service_id uuid;
  new_duration integer;
begin
  select * into o from public.driver_orders where restaurant_id=p_restaurant_id and id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into v from public.order_service_previews where id=p_preview_id and restaurant_id=p_restaurant_id and order_id=p_order_id for update;
  if not found or v.actor_user_id <> p_actor_user_id then raise exception 'PREVIEW_NOT_FOUND'; end if;
  if v.approved_at is not null then return jsonb_build_object('approved',true,'replayed',true); end if;
  if v.expires_at < now() or v.expected_version <> o.version then raise exception 'ORDER_VERSION_CONFLICT'; end if;
  if o.status <> 'sent' then raise exception 'ORDER_NOT_DISPATCHED'; end if;
  if o.specialist_id is null or o.driver_id is null then raise exception 'ORDER_ASSIGNMENT_REQUIRED'; end if;
  -- Same lock order as field actions: order first, then progress.
  perform 1 from public.field_order_progress where order_id=o.id for update;
  select jsonb_build_object('started',service_started_at,'completed',completed_at,'returned',driver_returned_at)
    into progress from public.field_order_progress where order_id=o.id;
  progress := coalesce(progress, '{"started":null,"completed":null,"returned":null}'::jsonb);
  if progress <> v.progress_snapshot or progress->>'completed' is not null or progress->>'returned' is not null then raise exception 'FIELD_VERSION_CONFLICT'; end if;
  if char_length(btrim(coalesce(p_specialist_message,''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_driver_message,''))) not between 1 and 2000 then raise exception 'MESSAGE_REQUIRED'; end if;
  if v.payload->>'sourceId' is not null then
    select * into r from public.rekaz_reservations where restaurant_id=p_restaurant_id and source_id=v.payload->>'sourceId' for update;
    if not found or r.removed_at is not null or r.status in ('Cancelled','Done') or r.payload_hash <> v.payload->>'sourceHash' then raise exception 'REKAZ_CHANGED'; end if;
  end if;
  if exists(select 1 from public.driver_orders other where other.restaurant_id=p_restaurant_id and other.id<>o.id
    and (other.specialist_id=o.specialist_id or other.driver_id=o.driver_id)
    and other.arrival_at >= (v.payload->>'oldEnd')::timestamptz and other.arrival_at < (v.payload->>'newEnd')::timestamptz) then
    raise exception 'SCHEDULE_CONFLICT';
  end if;
  service_id := nullif(v.payload->>'serviceId','')::uuid;
  new_duration := (v.payload->>'durationMinutes')::integer;
  if new_duration not between 5 and 480 then raise exception 'ORDER_DURATION_INVALID'; end if;
  if service_id is null then
    insert into public.order_visit_services(restaurant_id, order_id, source_id, source_payload, name, minutes, starts_at)
    values(p_restaurant_id,o.id,v.payload->>'sourceId',r.payload,v.payload->>'name',(v.payload->>'minutes')::integer,(v.payload->>'startsAt')::timestamptz)
    returning id into service_id;
  else
    update public.order_visit_services set source_id=coalesce(v.payload->>'sourceId',source_id),
      source_payload=coalesce(r.payload,source_payload), name=v.payload->>'name', minutes=(v.payload->>'minutes')::integer,
      starts_at=(v.payload->>'startsAt')::timestamptz
    where id=service_id and restaurant_id=p_restaurant_id and order_id=o.id;
    if not found then raise exception 'SERVICE_NOT_FOUND'; end if;
  end if;
  update public.driver_orders set duration_minutes=new_duration, version=version+1, updated_at=now(), updated_by=p_actor_team_member_id,
    specialist_note=concat_ws(E'\n\n',nullif(specialist_note,''),p_specialist_message),
    driver_note=concat_ws(E'\n\n',nullif(driver_note,''),p_driver_message)
  where id=o.id;
  insert into public.order_service_notifications(restaurant_id,order_id,preview_id,role,roster_id,title,body)
  values (p_restaurant_id,o.id,v.id,'specialist',o.specialist_id,v.payload->>'specialistTitle',p_specialist_message),
    (p_restaurant_id,o.id,v.id,'driver',o.driver_id,v.payload->>'driverTitle',p_driver_message);
  update public.order_service_previews set approved_at=now() where id=v.id;
  insert into public.operation_events(restaurant_id,aggregate_type,aggregate_id,event_type,actor_type,actor_role,actor_user_id,actor_team_member_id,payload)
  values(p_restaurant_id,'driver_order',o.id,'order.service_approved',case when p_actor_team_member_id is null then 'owner' else 'team_member' end,
    p_actor_role,p_actor_user_id,p_actor_team_member_id,v.payload || jsonb_build_object('serviceId',service_id,'previewId',v.id));
  return jsonb_build_object('approved',true,'replayed',false);
end $$;
revoke all on function public.kiara_approve_service_change(uuid,uuid,uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.kiara_approve_service_change(uuid,uuid,uuid,uuid,uuid,text,text,text) to service_role;

-- Uses the existing Vault cron_secret. No messages are sent until staff approve.
select cron.schedule('kiara-service-changes','*/2 * * * *', $command$
  select net.http_post(
    url := 'https://kiara-chat-eight.vercel.app/api/cron/service-changes',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    timeout_milliseconds := 55000
  );
$command$);

-- Scheduled pulls have no human actor; keep audit attribution truthful.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.kiara_apply_rekaz_snapshot(uuid,uuid,uuid,uuid,jsonb,timestamptz,timestamptz,text)'::regprocedure);
  definition := replace(definition,
    'v_actor_type := case when p_actor_team_member_id is null then ''owner'' else ''team_member'' end;',
    'v_actor_type := case when p_actor_user_id is null then ''system'' when p_actor_team_member_id is null then ''owner'' else ''team_member'' end;');
  execute definition;
end $$;
