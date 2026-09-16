-- WhatsApp calling permission, per customer.
--
-- A business may not call a WhatsApp user without their explicit permission,
-- and that permission is neither permanent nor ours to assume: a temporary
-- grant lasts 7 days, the customer can revoke it from the business profile at
-- any time, and four consecutive unanswered calls revoke it automatically
-- without any webhook we can act on.
--
-- This table is therefore a *fast path and an audit record*, never the
-- authority. Graph's /call_permissions endpoint is the authority, and the call
-- button reads it before enabling itself. What lives here is what we were last
-- told, so the inbox can render "callable / asked / declined" without a Graph
-- round trip per row, and so the owner's report can answer who was asked and
-- when.

create table public.call_permissions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),

  -- Stored in the same shape as conversations.customer_phone: leading `+`,
  -- country code, no punctuation. The constraint is deliberate. This codebase
  -- has already lost a round to normalizePhone() returning national digits
  -- (`502376231`) while the columns hold `+966502376231`, which turns every
  -- eq() into a silent miss rather than an error. Writing the wrong shape here
  -- fails loudly at insert time instead.
  customer_phone text not null
    check (customer_phone ~ '^\+[1-9][0-9]{7,14}$'),

  -- none      — never asked
  -- requested — asked, no reply yet (expires on its own after 7 days)
  -- granted   — may call, subject to expires_at
  -- declined  — customer said no
  -- expired   — a temporary grant ran out
  -- revoked   — withdrawn by the customer, or auto-revoked after 4 no-answers
  status text not null default 'none'
    check (status in ('none','requested','granted','declined','expired','revoked')),

  -- Null for a permanent grant; set for a temporary one. `granted` with an
  -- expires_at in the past is stale, not callable — readers must check both.
  is_permanent boolean not null default false,
  expires_at timestamptz,

  -- 'user_action' when the customer tapped accept/reject, 'automatic' when the
  -- permission came from callback_permission_status because they called us
  -- first. Worth keeping: the automatic path is free and tells us the customer
  -- initiated contact.
  response_source text,

  requested_at timestamptz,
  -- Message id of the permission request, so the reply webhook (which arrives
  -- with a `context.id` pointing back at it) can be correlated to this row.
  request_message_sid text,
  requested_by_user_id uuid,
  responded_at timestamptz,

  -- When we last reconciled against Graph, so a reader can tell a fresh answer
  -- from a remembered one.
  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (restaurant_id, customer_phone)
);

create index call_permissions_status_idx
  on public.call_permissions(restaurant_id, status);

-- Append-only history. The current-state row above is upserted in place, so
-- without this there is no record that a customer granted permission in March
-- and revoked it in April — and revocation is exactly the event someone will
-- need to explain later.
create table public.call_permission_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  permission_id uuid not null
    references public.call_permissions(id) on delete cascade,
  customer_phone text not null
    check (customer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- requested | granted | declined | expired | revoked | synced
  event text not null
    check (event in ('requested','granted','declined','expired','revoked','synced')),
  is_permanent boolean,
  expires_at timestamptz,
  response_source text,
  actor_user_id uuid,
  -- The raw webhook or Graph payload this row was derived from. Kept for the
  -- same reason meta_errors is kept on messages: when a payload shape drifts,
  -- the runtime log has long since rolled off.
  payload jsonb,
  created_at timestamptz not null default now()
);

create index call_permission_events_phone_idx
  on public.call_permission_events(restaurant_id, customer_phone, created_at desc);

-- Reached only through the service role, exactly like the other webhook-fed
-- tables (rekaz_reservations, outbox_events). Nothing in the browser or the
-- mobile app talks to these directly; both go through the API routes, which
-- already carry the team-member authorization.
revoke all on table public.call_permissions from public, anon, authenticated;
revoke all on table public.call_permission_events from public, anon, authenticated;

create schema if not exists kiara_private;
revoke all on schema kiara_private from public, anon, authenticated;

create or replace function kiara_private.tg_touch_call_permissions()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function kiara_private.tg_touch_call_permissions()
  from public, anon, authenticated;

drop trigger if exists touch_call_permissions on public.call_permissions;
create trigger touch_call_permissions
before update on public.call_permissions
for each row execute function kiara_private.tg_touch_call_permissions();
