-- Kiara Operations mobile inbox: authorize each signed-in employee to receive
-- only the private Realtime Broadcast topic derived from their own team row.
-- The broadcast carries opaque conversation ids only; all data is still
-- fetched through the mobile API, where routing visibility is enforced again.

drop policy if exists kiara_mobile_receive_employee_inbox
  on realtime.messages;

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

-- Verification after applying:
-- select policyname, cmd, roles, qual
-- from pg_policies
-- where schemaname = 'realtime'
--   and tablename = 'messages'
--   and policyname = 'kiara_mobile_receive_employee_inbox';
