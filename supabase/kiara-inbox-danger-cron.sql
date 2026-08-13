-- Schedules the late-conversation (خطر) sweep.
--
-- The other two inbox alerts ride on an event (a message arrived) and fire from
-- the WhatsApp ingest webhook. This one is about time passing, which nothing in
-- the app observes, so it needs a caller on a schedule.
--
-- Mirrors the existing `internal_cron.call_endpoint` pattern already used on
-- this database, with two differences: it points at Kiara's own deployment
-- rather than the parent whatsapp-cs app, and its Vault reader is restricted to
-- `kiara_*` secrets instead of reading any secret by name.
--
-- Everything here is Kiara-scoped and additive. `pg_cron` and `pg_net` are
-- already installed on this project, so no extension changes are needed.
--
-- IMPORTANT: the same secret must exist in Vercel's production environment as
-- CRON_SECRET, or every call comes back 401.
--
-- Already applied to project nkdkqgrkyqpjdaifazwn on 2026-08-13 as migrations
-- `kiara_inbox_danger_cron` and `kiara_inbox_danger_cron_schedule`. Kept here as
-- the reviewable record, and it is safe to re-run.
--
-- To undo:  select cron.unschedule('kiara-inbox-danger');

-- 1. Kiara's cron target and shared secret. Guarded rather than a bare
--    create_secret so re-running this file cannot trip the unique name.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'kiara_cron_base_url') then
    perform vault.create_secret(
      'https://kiara-chat-eight.vercel.app',
      'kiara_cron_base_url',
      'Base URL for Kiara Chat cron HTTP calls'
    );
  end if;

  -- Must match Vercel's CRON_SECRET exactly. To rotate, update both, then:
  --   select vault.update_secret(
  --     (select id from vault.secrets where name = 'kiara_cron_secret'), '<new>');
  if not exists (select 1 from vault.secrets where name = 'kiara_cron_secret') then
    perform vault.create_secret(
      'REPLACE_WITH_CRON_SECRET',
      'kiara_cron_secret',
      'Shared secret for Kiara /api/cron/* endpoints'
    );
  end if;
end
$$;

-- 2. A Vault reader that can only ever return Kiara's own secrets.
create or replace function kiara_private.get_secret(name text)
returns text
language sql
stable
security definer
set search_path to 'vault', 'public'
as $function$
  select decrypted_secret
  from vault.decrypted_secrets
  where vault.decrypted_secrets.name = $1
    and $1 like 'kiara\_%'
  limit 1;
$function$;

revoke all on function kiara_private.get_secret(text) from public, anon, authenticated;

-- 3. The caller. Sends both auth headers: `Authorization: Bearer` is what the
--    route prefers, `x-cron-secret` is what a plain curl or another scheduler
--    finds easier — the route accepts either.
create or replace function kiara_private.call_kiara_endpoint(
  path text,
  method text default 'GET'
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  base_url text := kiara_private.get_secret('kiara_cron_base_url');
  secret   text := kiara_private.get_secret('kiara_cron_secret');
  req_id   bigint;
  hdrs     jsonb;
begin
  if base_url is null or secret is null then
    raise warning '[kiara_cron] kiara_cron_base_url or kiara_cron_secret not set in vault — skipping %', path;
    return null;
  end if;

  hdrs := jsonb_build_object(
    'Authorization', 'Bearer ' || secret,
    'x-cron-secret', secret,
    'Content-Type',  'application/json'
  );

  if upper(method) = 'GET' then
    select net.http_get(
      url := base_url || path,
      headers := hdrs,
      timeout_milliseconds := 30000
    ) into req_id;
  else
    select net.http_post(
      url := base_url || path,
      body := '{}'::jsonb,
      headers := hdrs,
      timeout_milliseconds := 30000
    ) into req_id;
  end if;

  return req_id;
end;
$function$;

revoke all on function kiara_private.call_kiara_endpoint(text, text) from public, anon, authenticated;

-- 4. Once a minute. The danger line is six minutes, so a slower cadence would
--    just delay every alert by the difference.
select cron.schedule(
  'kiara-inbox-danger',
  '* * * * *',
  $job$select kiara_private.call_kiara_endpoint('/api/cron/inbox-danger', 'GET');$job$
);
