-- Which specialist performs which service, when two are sent to one visit.
--
-- Nothing here deletes data. Every statement is additive: a nullable column, an
-- index, two trigger functions. The `drop trigger if exists` lines only remove
-- the triggers this same file creates, so the script can be re-run safely.
--
-- Each statement briefly needs an exclusive lock on its table. Rather than
-- queue behind a long-running transaction — which would stall dispatch while it
-- waited — give up after five seconds and leave everything as it was. Re-run it
-- a moment later; a failed attempt changes nothing.
set lock_timeout = '5s';

--
-- Nullable on purpose, and null keeps today's meaning: the service belongs to
-- whoever the order's specialists are. Every existing row stays null, so the
-- dispatch flow, the specialist messages and older app builds behave exactly
-- as they do now until a split is actually chosen.
alter table public.order_visit_services
  add column if not exists assigned_specialist_id uuid references public.specialists(id);

-- The field app asks "what is mine on this visit", so the order is the entry
-- point and the specialist narrows it.
create index if not exists order_visit_services_assignment_idx
  on public.order_visit_services(restaurant_id, order_id, assigned_specialist_id)
  where assigned_specialist_id is not null;

-- A service may only be assigned to someone actually sent on that visit.
-- Without this a typo or a stale screen could hand a service to a specialist
-- who is not coming, and it would then appear in nobody's message — the one
-- failure the split must never produce.
create or replace function public.kiara_check_service_assignment() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare o public.driver_orders%rowtype;
begin
  if new.assigned_specialist_id is null then return new; end if;
  select * into o from public.driver_orders where id = new.order_id;
  if not found then return new; end if;
  if new.assigned_specialist_id is distinct from o.specialist_id
     and new.assigned_specialist_id is distinct from o.second_specialist_id then
    raise exception 'SERVICE_ASSIGNEE_NOT_ON_ORDER';
  end if;
  return new;
end $$;
revoke all on function public.kiara_check_service_assignment() from public, anon, authenticated;
grant execute on function public.kiara_check_service_assignment() to service_role;

drop trigger if exists check_service_assignment on public.order_visit_services;
create trigger check_service_assignment
  before insert or update of assigned_specialist_id, order_id
  on public.order_visit_services
  for each row execute function public.kiara_check_service_assignment();

-- Swapping or removing a specialist must not strand her services. Clearing the
-- assignment returns those rows to "whoever is on the order", which is the
-- same state as a visit that was never split — never an empty service list.
create or replace function public.kiara_clear_orphaned_service_assignments() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  update public.order_visit_services
     set assigned_specialist_id = null
   where order_id = new.id
     and assigned_specialist_id is not null
     and assigned_specialist_id is distinct from new.specialist_id
     and assigned_specialist_id is distinct from new.second_specialist_id;
  return null;
end $$;
revoke all on function public.kiara_clear_orphaned_service_assignments() from public, anon, authenticated;
grant execute on function public.kiara_clear_orphaned_service_assignments() to service_role;

drop trigger if exists clear_orphaned_service_assignments on public.driver_orders;
create trigger clear_orphaned_service_assignments
  after update of specialist_id, second_specialist_id on public.driver_orders
  for each row
  when (old.specialist_id is distinct from new.specialist_id
     or old.second_specialist_id is distinct from new.second_specialist_id)
  execute function public.kiara_clear_orphaned_service_assignments();
