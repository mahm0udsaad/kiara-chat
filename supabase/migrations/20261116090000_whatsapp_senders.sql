-- Which of Kiara's own WhatsApp numbers a customer reply goes out from.
--
-- Until now every customer reply left from the Meta Business number. A second
-- customer-facing number is being added on its own OpenWA engine, and staff
-- choose per conversation which one answers. Three small things make that safe:
--
-- 1. `whatsapp_senders` lists the numbers staff may choose from. Credentials
--    are NOT here — each engine's URL and tokens stay in server env, keyed by
--    the sender id. This table only says what exists, whether it is on, and
--    who may use it.
-- 2. `messages.sender_account` records the number each message actually went
--    through or arrived on. Null on history: those rows predate the choice and
--    read as the Meta number (customer threads) or the orders number (field
--    team threads), which is what they were.
-- 3. `conversations.reply_sender` is the team's saved choice for that customer.
--    Null means the default, the Meta number. A column, not a metadata key, so
--    two employees switching at once cannot overwrite each other's other
--    metadata in a read-modify-write.
--
-- The orders number (pm2 `kiara-wa`, sender id `openwa`) is not listed: it is
-- for the field team and is chosen by the thread, never by staff.

create table if not exists public.whatsapp_senders (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,31}$'),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  provider text not null check (provider in ('meta', 'openwa')),
  -- +E.164, shown to staff. Null until the number is linked.
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  label text not null,
  enabled boolean not null default true,
  -- team_members.role values allowed to send from it.
  allowed_roles text[] not null default array['admin', 'agent'],
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_senders enable row level security;
revoke all on public.whatsapp_senders from public, anon, authenticated;
grant select, insert, update on public.whatsapp_senders to service_role;

insert into public.whatsapp_senders (id, restaurant_id, provider, phone, label, enabled, sort_order)
values
  ('meta', '2ba8f6c8-aff9-4147-8f13-cdcb732de698', 'meta', '+966508421748', 'رقم الأعمال (Meta)', true, 0),
  -- Off until its engine is linked and its phone filled in.
  ('openwa_cs', '2ba8f6c8-aff9-4147-8f13-cdcb732de698', 'openwa', null, 'الرقم الثاني (OpenWA)', false, 1)
on conflict (id) do nothing;

alter table public.messages
  add column if not exists sender_account text;

-- Meta's 24-hour window is read from the latest customer message on Meta.
create index if not exists idx_messages_conversation_inbound_sender
  on public.messages (conversation_id, created_at desc)
  where role = 'customer';

alter table public.conversations
  add column if not exists reply_sender text references public.whatsapp_senders(id);
