-- A mobile request can finish on the server after the phone has timed out.
-- Retrying that request must return the recorded message, not send it twice.
alter table public.messages
  add column if not exists client_request_id uuid;

create unique index if not exists messages_conversation_client_request_key
  on public.messages (conversation_id, client_request_id)
  where client_request_id is not null;

comment on column public.messages.client_request_id is
  'Client-generated UUID used to deduplicate outbound message retries.';
