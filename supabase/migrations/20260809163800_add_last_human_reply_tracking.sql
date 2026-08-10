-- Kiara mobile: track the most recent human CS reply independently from bot,
-- system, and other conversation activity. The six-minute danger queue must
-- compare this clock with last_inbound_at; last_message_at is intentionally not
-- sufficient because bot replies also advance it.

alter table public.conversations
  add column if not exists last_human_reply_at timestamptz;

comment on column public.conversations.last_human_reply_at is
  'Latest persisted human CS reply. Bot and system messages do not advance this clock.';

-- Trigger helpers stay outside the exposed public schema. Creating the schema
-- is harmless when the shared project already has it.
create schema if not exists kiara_private;
revoke all on schema kiara_private from public, anon, authenticated;

-- Existing writers do not yet use one common attribution field:
--   Kiara web              -> sender_team_member_id + source=app
--   shared mobile          -> metadata.sent_by_team_member_id
--   shared dashboard       -> metadata.sender_team_member_id
--   a reply from WhatsApp  -> source=whatsapp_app
--   the bot                -> source=bot (must not match)
-- Keep this function small and immutable so the backfill and insert trigger use
-- exactly the same classification rule.
create or replace function kiara_private.is_human_cs_reply(
  p_role text,
  p_sender_team_member_id uuid,
  p_metadata jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select
    p_role = 'agent'
    and (
      p_sender_team_member_id is not null
      or nullif(btrim(coalesce(p_metadata ->> 'sent_by_team_member_id', '')), '') is not null
      or nullif(btrim(coalesce(p_metadata ->> 'sender_team_member_id', '')), '') is not null
      or coalesce(p_metadata ->> 'source', '') in (
        'app',
        'whatsapp_app',
        'dashboard_inbox',
        'inbox_composer'
      )
    );
$$;

revoke all on function kiara_private.is_human_cs_reply(text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function kiara_private.tg_set_last_human_reply_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if kiara_private.is_human_cs_reply(
    new.role,
    new.sender_team_member_id,
    new.metadata
  ) then
    update public.conversations
       set last_human_reply_at = case
         when last_human_reply_at is null
           or new.created_at > last_human_reply_at
           then new.created_at
         else last_human_reply_at
       end
     where id = new.conversation_id;
  end if;

  return new;
end;
$$;

revoke all on function kiara_private.tg_set_last_human_reply_at()
  from public, anon, authenticated;

drop trigger if exists set_last_human_reply_at_on_message
  on public.messages;

create trigger set_last_human_reply_at_on_message
  after insert on public.messages
  for each row
  execute function kiara_private.tg_set_last_human_reply_at();

-- Backfill from the existing message history. max(created_at) makes the result
-- independent of insertion order and preserves newer values if this migration
-- is replayed after live inserts.
with human_replies as (
  select
    m.conversation_id,
    max(m.created_at) as replied_at
  from public.messages m
  where kiara_private.is_human_cs_reply(
    m.role,
    m.sender_team_member_id,
    m.metadata
  )
  group by m.conversation_id
)
update public.conversations c
   set last_human_reply_at = case
     when c.last_human_reply_at is null
       or h.replied_at > c.last_human_reply_at
       then h.replied_at
     else c.last_human_reply_at
   end
  from human_replies h
 where c.id = h.conversation_id;

-- Supports the tenant-scoped danger sweep. Time-dependent predicates belong in
-- the query, not in a partial-index predicate.
create index if not exists conversations_danger_scan_idx
  on public.conversations (restaurant_id, last_inbound_at)
  include (last_human_reply_at, assigned_to)
  where status = 'active' and last_inbound_at is not null;

-- This migration adds a column to an already-exposed/RLS-protected table. Its
-- existing table grants continue to cover the new column; no new public table
-- or RPC is exposed. The private functions are deliberately not executable by
-- client roles.

-- Verification (run after applying in a controlled environment):
--
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'conversations'
--   and column_name = 'last_human_reply_at';
--
-- select tgname, tgenabled
-- from pg_trigger
-- where tgrelid = 'public.messages'::regclass
--   and tgname = 'set_last_human_reply_at_on_message'
--   and not tgisinternal;
--
-- select count(*) as backfilled_conversations
-- from public.conversations
-- where last_human_reply_at is not null;
--
-- -- Exact danger predicate used by the mobile/API layer:
-- select id
-- from public.conversations
-- where status = 'active'
--   and last_inbound_at <= now() - interval '6 minutes'
--   and (
--     last_human_reply_at is null
--     or last_human_reply_at < last_inbound_at
--   )
-- limit 20;
