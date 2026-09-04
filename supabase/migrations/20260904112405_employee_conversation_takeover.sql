-- Any active customer-service employee may rescue a conversation held by an
-- unavailable colleague. The reassignment and both audit records happen in
-- one database transaction, so two employees cannot successfully take the
-- same conversation at the same time without the later caller seeing that the
-- owner has already changed.
create or replace function public.take_over_conversation(
  p_conversation_id uuid,
  p_expected_assignee uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_conversation public.conversations%rowtype;
  v_actor_team_member_id uuid;
  v_actor_role text;
  v_previous_assignee uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_conversation_id is null then
    raise exception 'missing_arguments';
  end if;

  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'takeover_reason_required';
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

  v_previous_assignee := v_conversation.assigned_to;
  if v_previous_assignee is null
     or v_previous_assignee = v_actor_team_member_id then
    raise exception 'takeover_not_needed';
  end if;

  -- Compare-and-swap: if another employee rescued the thread after this
  -- caller opened it, do not immediately steal it back from the new owner.
  if p_expected_assignee is null
     or v_previous_assignee <> p_expected_assignee then
    raise exception 'takeover_owner_changed';
  end if;

  update public.conversations
     set handler_mode = 'human',
         assigned_to = v_actor_team_member_id,
         assigned_at = now(),
         assigned_by_user_id = v_user,
         bot_paused = true
   where id = p_conversation_id;

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
    v_actor_team_member_id,
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
    'conversation.taken_over',
    'team_member',
    v_actor_role,
    v_user,
    v_actor_team_member_id,
    jsonb_build_object(
      'reason', v_reason,
      'previousAssignee', v_previous_assignee
    )
  );

  return v_previous_assignee;
end;
$$;

revoke all on function public.take_over_conversation(uuid, uuid, text) from public;
revoke all on function public.take_over_conversation(uuid, uuid, text) from anon;
grant execute on function public.take_over_conversation(uuid, uuid, text) to authenticated;
grant execute on function public.take_over_conversation(uuid, uuid, text) to service_role;

comment on function public.take_over_conversation(uuid, uuid, text) is
  'Atomically lets any active restaurant team member take an assigned conversation, with a mandatory audited reason.';
