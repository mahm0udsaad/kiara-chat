-- Typing events contain conversation ids and must not be readable with the
-- public anon key. Every active Kiara operations member may receive them; the
-- conversation API remains the authority for opening the underlying thread.
drop policy if exists kiara_mobile_receive_typing_presence on realtime.messages;

create policy kiara_mobile_receive_typing_presence
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() = 'kiara-presence'
    and exists (
      select 1
      from public.team_members tm
      where tm.user_id = (select auth.uid())
        and tm.restaurant_id = '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid
        and tm.is_active = true
    )
  );
