-- A conversation transfer is different from an administrative force-claim:
-- the employee currently holding the conversation must be able to hand it to
-- a named colleague.  The legacy claim_conversation(p_force := true) path is
-- intentionally admin-only, so using it for the ordinary hand-off button made
-- every agent transfer fail with forbidden_not_admin.
--
-- Keep the hand-off atomic and auditable.  The row lock prevents a stale
-- screen from transferring a conversation after somebody else has taken it.
create or replace function public.transfer_conversation(
  p_conversation_id uuid,
  p_target_team_member_id uuid
)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_conversation public.conversations%rowtype;
  v_actor_team_member_id uuid;
  v_actor_role text;
  v_is_admin boolean;
  v_previous_assignee uuid;
begin
  if p_conversation_id is null or p_target_team_member_id is null then
    raise exception 'missing_arguments';
  end if;

  select c.*
    into v_conversation
    from public.conversations c
   where c.id = p_conversation_id
   for update;

  if not found then
    raise exception 'conversation_not_found';
  end if;

  select tm.id, tm.role
    into v_actor_team_member_id, v_actor_role
    from public.team_members tm
   where tm.restaurant_id = v_conversation.restaurant_id
     and tm.user_id = v_user
     and tm.is_active = true
   order by (tm.role = 'admin') desc
   limit 1;

  if v_actor_team_member_id is null then
    raise exception 'not_a_team_member';
  end if;

  if v_conversation.assigned_to is null then
    raise exception 'conversation_not_taken';
  end if;

  v_previous_assignee := v_conversation.assigned_to;

  -- This function requires an active team-member row above; within that
  -- boundary the role is the authoritative admin flag.
  v_is_admin := v_actor_role = 'admin';

  if v_conversation.assigned_to <> v_actor_team_member_id
     and not v_is_admin then
    raise exception 'forbidden_not_assignee';
  end if;

  if p_target_team_member_id = v_conversation.assigned_to then
    raise exception 'target_is_current_assignee';
  end if;

  if not exists (
    select 1
      from public.team_members target
     where target.id = p_target_team_member_id
       and target.restaurant_id = v_conversation.restaurant_id
       and target.is_active = true
       and target.user_id is not null
  ) then
    raise exception 'target_member_not_available';
  end if;

  update public.conversations
     set handler_mode = 'human',
         assigned_to = p_target_team_member_id,
         assigned_at = now(),
         assigned_by_user_id = v_user,
         bot_paused = true
   where id = p_conversation_id
   returning * into v_conversation;

  insert into public.conversation_claim_events (
    conversation_id,
    restaurant_id,
    team_member_id,
    mode,
    event_type,
    claimed_by_user_id
  ) values (
    p_conversation_id,
    v_conversation.restaurant_id,
    p_target_team_member_id,
    'human',
    'reassign',
    v_user
  );

  insert into public.operation_events (
    restaurant_id,
    aggregate_type,
    aggregate_id,
    event_type,
    actor_type,
    actor_role,
    actor_user_id,
    actor_team_member_id,
    payload
  ) values (
    v_conversation.restaurant_id,
    'conversation',
    p_conversation_id,
    'conversation.transferred',
    'team_member',
    v_actor_role,
    v_user,
    v_actor_team_member_id,
    jsonb_build_object(
      'previousAssignee', v_previous_assignee,
      'targetAssignee', p_target_team_member_id
    )
  );

  return v_conversation;
end;
$$;

revoke all on function public.transfer_conversation(uuid, uuid) from public;
revoke all on function public.transfer_conversation(uuid, uuid) from anon;
grant execute on function public.transfer_conversation(uuid, uuid) to authenticated;
grant execute on function public.transfer_conversation(uuid, uuid) to service_role;

comment on function public.transfer_conversation(uuid, uuid) is
  'Atomically transfers a held conversation from its current assignee (or an admin) to an active colleague and records the hand-off.';
