-- Every active employee can rescue a conversation from an unavailable
-- colleague. The database must change ownership and record the reason
-- atomically, while outsiders and inactive employees remain blocked.

\set ON_ERROR_STOP on
set client_min_messages = notice;

update public.conversations
set assigned_to = 'a0000000-0000-0000-0000-000000000002',
    assigned_at = now(),
    handler_mode = 'human',
    bot_paused = true
where id = 'd0000000-0000-0000-0000-000000000001';

begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select public.take_over_conversation(
  'd0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'الموظفة غير متاحة'
);

-- Inspect as the harness owner. Production clients receive the updated
-- conversation through the authorized server API rather than reading these
-- audit tables directly.
reset role;

select kiara_test.ok(
  (select assigned_to
     from public.conversations
    where id = 'd0000000-0000-0000-0000-000000000001')
    = 'a0000000-0000-0000-0000-000000000003',
  'an active agent can take over from another agent'
);

select kiara_test.ok(
  exists (
    select 1
      from public.operation_events
     where aggregate_id = 'd0000000-0000-0000-0000-000000000001'
       and event_type = 'conversation.taken_over'
       and actor_team_member_id = 'a0000000-0000-0000-0000-000000000003'
       and actor_role = 'agent'
       and payload ->> 'reason' = 'الموظفة غير متاحة'
       and payload ->> 'previousAssignee'
         = 'a0000000-0000-0000-0000-000000000002'
  ),
  'the takeover reason and previous employee are audited'
);

select kiara_test.ok(
  exists (
    select 1
      from public.conversation_claim_events
     where conversation_id = 'd0000000-0000-0000-0000-000000000001'
       and team_member_id = 'a0000000-0000-0000-0000-000000000003'
       and event_type = 'reassign'
  ),
  'the assignment history records the employee takeover'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select kiara_test.raises(
  $sql$select public.take_over_conversation(
    'd0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000003',
    'urgent rescue'
  )$sql$,
  'not_a_team_member',
  'an authenticated outsider cannot take a conversation'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select kiara_test.raises(
  $sql$select public.take_over_conversation(
    'd0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'الموظفة غير متاحة'
  )$sql$,
  'takeover_owner_changed',
  'a stale screen cannot steal the conversation back from its new owner'
);

select kiara_test.raises(
  $sql$select public.take_over_conversation(
    'd0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000003',
    'x'
  )$sql$,
  'takeover_reason_required',
  'an employee cannot take over without a meaningful reason'
);
commit;
