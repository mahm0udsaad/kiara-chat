-- What the mobile app saw go wrong on a phone.
--
-- The app kept no record of its own failures, so "it lags and crashes" could
-- not be traced to a screen, a device or a cause. The app now reports the
-- moments themselves: a screen that threw while drawing, a fatal JavaScript
-- error, an interface that stopped responding, a slow or failed request, and
-- a session that ended while the app was still on screen.
--
-- Rows are written by the server on the phone's behalf and read only with the
-- service role. No policies: there is nothing here for an app user to query.

create table if not exists public.mobile_diagnostics (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null,
  role text not null,
  kind text not null check (kind in (
    'render_error', 'fatal_js', 'stall', 'slow_request', 'request_summary', 'unclean_exit'
  )),
  message text,
  stack text,
  -- The route pattern on screen, e.g. (app)/conversation/[id]; never an id.
  route text,
  details jsonb not null default '{}'::jsonb,
  platform text,
  os_version text,
  device_model text,
  app_version text,
  update_id text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists mobile_diagnostics_recent_idx
  on public.mobile_diagnostics (restaurant_id, created_at desc);

alter table public.mobile_diagnostics enable row level security;
revoke all on public.mobile_diagnostics from public, anon, authenticated;
grant select, insert, delete on public.mobile_diagnostics to service_role;
grant usage, select on sequence public.mobile_diagnostics_id_seq to service_role;
