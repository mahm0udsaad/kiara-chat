-- The current assignee can hand a conversation to a named active colleague.
-- Other agents cannot transfer it, and every successful hand-off is audited.

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
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select public.transfer_conversation(
  'd0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000003'
);

reset role;

select kiara_test.ok(
  (select assigned_to
     from public.conversations
    where id = 'd0000000-0000-0000-0000-000000000001')
    = 'a0000000-0000-0000-0000-000000000003',
  'the current assignee can transfer to another active employee'
);

select kiara_test.ok(
  exists (
    select 1
      from public.operation_events
     where aggregate_id = 'd0000000-0000-0000-0000-000000000001'
       and event_type = 'conversation.transferred'
       and actor_team_member_id = 'a0000000-0000-0000-0000-000000000002'
       and payload ->> 'previousAssignee'
         = 'a0000000-0000-0000-0000-000000000002'
       and payload ->> 'targetAssignee'
         = 'a0000000-0000-0000-0000-000000000003'
  ),
  'the hand-off records its sender and recipient'
);

select kiara_test.ok(
  exists (
    select 1
      from public.conversation_claim_events
     where conversation_id = 'd0000000-0000-0000-0000-000000000001'
       and team_member_id = 'a0000000-0000-0000-0000-000000000003'
       and event_type = 'reassign'
  ),
  'the assignment history records the recipient'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select kiara_test.raises(
  $sql$select public.transfer_conversation(
    'd0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002'
  )$sql$,
  'forbidden_not_assignee',
  'a former assignee cannot transfer a conversation back'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.transfer_conversation(
  'd0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002'
);
reset role;

select kiara_test.ok(
  (select assigned_to
     from public.conversations
    where id = 'd0000000-0000-0000-0000-000000000001')
    = 'a0000000-0000-0000-0000-000000000002',
  'an admin can transfer a conversation held by another employee'
);
commit;
