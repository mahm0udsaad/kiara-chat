-- WhatsApp voice calls: the record of one, and the SDP handoff behind it.
--
-- Media never touches this server. Cloud API calling is signalling over HTTPS:
-- an SDP offer goes out on `POST /<PHONE_NUMBER_ID>/calls`, the answer comes
-- back on the `calls` webhook, and the SRTP then flows over ICE directly
-- between the staff member's browser and Meta's media servers. What is stored
-- here is the blob in transit and the history afterwards.
--
-- `remote_sdp` is deliberately persisted rather than only broadcast. The
-- webhook carrying the answer can land before the caller's browser has
-- finished subscribing to the realtime channel, and a broadcast nobody is
-- listening to is simply lost — which would strand a call that Meta considers
-- connected. The row is the durable copy the client can fetch.

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  conversation_id uuid references public.conversations(id) on delete set null,

  -- Same `+E.164` shape and the same reason as call_permissions: this codebase
  -- has already lost a round to national-format digits silently failing eq().
  customer_phone text not null
    check (customer_phone ~ '^\+[1-9][0-9]{7,14}$'),

  -- Meta's call id (`wacid.…`). Unique, and the idempotency anchor: the calls
  -- webhook retries, and the same event can arrive more than once.
  wa_call_id text not null,

  direction text not null
    check (direction in ('business_initiated','user_initiated')),

  -- initiated — offer sent, nothing back yet
  -- ringing   — the customer's phone is ringing
  -- accepted  — she answered; media negotiating
  -- connected — audio flowing
  -- rejected  — she declined
  -- completed — ended normally
  -- failed    — ended abnormally, see `error`
  status text not null default 'initiated'
    check (status in ('initiated','ringing','accepted','connected','rejected','completed','failed')),

  -- The SDP answer from Meta, held until the caller's client collects it.
  -- Cleared once the call ends: it is a handshake artefact, not history, and
  -- an SDP body is large enough that keeping thousands of them is waste.
  remote_sdp text,
  remote_sdp_type text check (remote_sdp_type in ('offer','answer')),

  initiated_by_user_id uuid,
  /** Our own correlation string, echoed back by Meta on status webhooks. */
  biz_opaque_callback_data text,

  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (restaurant_id, wa_call_id)
);

create index calls_conversation_idx
  on public.calls(restaurant_id, conversation_id, created_at desc);
create index calls_phone_idx
  on public.calls(restaurant_id, customer_phone, created_at desc);
-- Supports the "is this call still live" lookups without scanning history.
create index calls_live_idx
  on public.calls(restaurant_id, status)
  where status in ('initiated','ringing','accepted','connected');

-- Every lifecycle event exactly once. This is what makes a retried webhook
-- harmless: the insert conflicts rather than re-applying a transition, and a
-- late duplicate of `terminate` cannot overwrite a completed call's duration.
create table public.call_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  call_id uuid not null references public.calls(id) on delete cascade,
  wa_call_id text not null,
  -- connect | terminate | ringing | accepted | rejected | initiated
  event text not null
    check (event in ('initiated','connect','ringing','accepted','rejected','terminate')),
  payload jsonb,
  created_at timestamptz not null default now(),

  -- The idempotency key. `status` webhooks and `calls` webhooks both retry.
  unique (restaurant_id, wa_call_id, event)
);

create index call_events_call_idx
  on public.call_events(restaurant_id, call_id, created_at);

-- Service role only, like the other webhook-fed tables. The browser reaches
-- calls through API routes that carry the team-member authorization.
revoke all on table public.calls from public, anon, authenticated;
revoke all on table public.call_events from public, anon, authenticated;

create schema if not exists kiara_private;
revoke all on schema kiara_private from public, anon, authenticated;

create or replace function kiara_private.tg_touch_calls()
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

revoke all on function kiara_private.tg_touch_calls()
  from public, anon, authenticated;

drop trigger if exists touch_calls on public.calls;
create trigger touch_calls
before update on public.calls
for each row execute function kiara_private.tg_touch_calls();
