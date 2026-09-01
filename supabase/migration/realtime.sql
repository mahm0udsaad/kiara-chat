-- Phase 2c — Realtime wiring.
--
-- Neither half of this survives a `pg_dump --schema=public`: publication
-- membership is a database-level object, and the broadcast authorization policy
-- lives on realtime.messages. Both are silent when missing — the inbox simply
-- stops updating live, with no error anywhere.
--
-- Run after build/schema.sql.

\set ON_ERROR_STOP on

-- 1. Postgres-changes feed. Exactly the five tables the source publishes.
--    src/components/inbox/use-inbox-realtime.ts subscribes to conversations and
--    messages; the rest keep parity with the source project.
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.conversation_claim_events;
alter publication supabase_realtime add table public.agent_shifts;

-- 2. Private broadcast topic for the mobile inbox: each signed-in employee may
--    receive only the topic derived from their own team row. The broadcast
--    carries opaque conversation ids; data is still fetched through the mobile
--    API, where routing visibility is enforced again.
--
--    Ported from supabase/migrations/20260811142134_secure_mobile_inbox_realtime.sql.
--    The tenant id is the same on the new project — ids are preserved across the
--    migration — so this needs no edit.
drop policy if exists kiara_mobile_receive_employee_inbox on realtime.messages;

create policy kiara_mobile_receive_employee_inbox
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() = (
      select 'kiara-inbox:' || tm.id::text
      from public.team_members tm
      where tm.user_id = (select auth.uid())
        and tm.restaurant_id = '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid
        and tm.is_active = true
      limit 1
    )
  );

-- 3. Shared but authenticated typing topic. It is ephemeral and carries only a
-- conversation id + state; opening data still goes through the routed API.
drop policy if exists kiara_mobile_receive_typing_presence on realtime.messages;

create policy kiara_mobile_receive_typing_presence
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() = 'kiara-presence'
    and exists (
      select 1 from public.team_members tm
      where tm.user_id = (select auth.uid())
        and tm.restaurant_id = '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid
        and tm.is_active = true
    )
  );

-- Verify:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime';
--   select policyname from pg_policies
--    where schemaname = 'realtime' and tablename = 'messages';
