-- Shift handoff: release one employee's held conversations, or every held
-- conversation in the tenant. The server calls this as service_role, so the
-- invoker already has the table privileges needed to keep the row locks and
-- ownership/routing changes atomic without bypassing RLS in the function.
create or replace function public.release_assigned_conversations(
  p_restaurant_id uuid,
  p_team_member_id uuid default null
)
returns table (conversation_id uuid, previous_assignee uuid)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with candidates as (
    select c.id, c.assigned_to
    from public.conversations c
    where c.restaurant_id = p_restaurant_id
      and c.assigned_to is not null
      and (p_team_member_id is null or c.assigned_to = p_team_member_id)
    for update
  ), updated as (
    update public.conversations c
    set handler_mode = 'unassigned',
        assigned_to = null,
        assigned_at = null,
        metadata = coalesce(c.metadata, '{}'::jsonb) - 'routed_to'
    from candidates
    where c.id = candidates.id
    returning c.id, candidates.assigned_to
  )
  select updated.id, updated.assigned_to from updated;
$$;

revoke all on function public.release_assigned_conversations(uuid, uuid) from public;
revoke all on function public.release_assigned_conversations(uuid, uuid) from anon;
revoke all on function public.release_assigned_conversations(uuid, uuid) from authenticated;
grant execute on function public.release_assigned_conversations(uuid, uuid) to service_role;

comment on function public.release_assigned_conversations(uuid, uuid) is
  'Atomically releases held conversations for one team member or a whole tenant and clears exclusive routing.';
