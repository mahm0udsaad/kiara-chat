-- Let staff receive call signalling on the private broadcast channel.
--
-- Realtime's private channels are gated by RLS on realtime.messages, and the
-- existing policies match one exact topic each ('kiara-presence') or one
-- derived topic ('kiara-inbox:' || team_member_id). A call's topic carries the
-- Meta call id, which is not known until the call exists, so this one matches
-- on the prefix instead.
--
-- Scope: any active team member of the Kiara tenant, the same audience as the
-- typing-presence channel. That is deliberately broader than "the employee who
-- placed the call" — an SDP body does contain the customer's ICE candidates,
-- but every member of this team already reads that customer's whole
-- conversation, and the alternative needs a select on public.calls, which is
-- revoked from `authenticated` precisely so the browser cannot read it. The
-- topic is unguessable and the payload is worthless once the call ends.
--
-- Sending is not covered here and must not be: the server broadcasts with the
-- service role, which bypasses RLS. Nothing in the browser may publish onto a
-- call channel.

drop policy if exists kiara_receive_call_signalling on realtime.messages;

create policy kiara_receive_call_signalling
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() like 'kiara-call:%'
    and exists (
      select 1
      from public.team_members tm
      where tm.user_id = (select auth.uid())
        and tm.restaurant_id = '2ba8f6c8-aff9-4147-8f13-cdcb732de698'::uuid
        and tm.is_active = true
    )
  );
