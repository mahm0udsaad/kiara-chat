-- `pg_cron` and `pg_net` ship with Supabase but not with a stock Postgres
-- build. These stubs exist so 20260811120000 can be applied verbatim and its
-- SQL body — the reminder selection logic, which is the part that can actually
-- be wrong — is compiled and executed for real.
--
-- What the stubs deliberately do NOT prove: that the schedule fires, or that
-- the Expo request is delivered. Those remain hosted-only checks.

create schema if not exists cron;
create schema if not exists net;

create table if not exists cron.job (
  jobid bigint generated always as identity primary key,
  schedule text not null,
  command text not null,
  jobname text,
  active boolean not null default true
);

create or replace function cron.schedule(p_name text, p_schedule text, p_command text)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into cron.job (schedule, command, jobname)
  values (p_schedule, p_command, p_name)
  returning jobid into v_id;
  return v_id;
end;
$$;

create or replace function cron.unschedule(p_jobid bigint)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobid = p_jobid;
  return true;
end;
$$;

-- Records the request instead of making it, so a test can assert that a
-- reminder run would have pushed, and to whom.
create table if not exists net.http_request_log (
  id bigint generated always as identity primary key,
  url text,
  headers jsonb,
  body jsonb,
  requested_at timestamptz not null default now()
);

create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into net.http_request_log (url, headers, body)
  values (url, headers, body)
  returning id into v_id;
  return v_id;
end;
$$;
