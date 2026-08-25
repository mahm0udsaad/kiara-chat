-- Phase 6 — scheduled work on the dedicated project.
--
-- The kiara_private functions themselves (get_secret, call_kiara_endpoint,
-- enqueue_field_reminders) arrive with build/schema.sql, since dump-schema.sh
-- dumps the kiara_private schema. This file supplies what a schema dump cannot
-- carry: the Vault secrets and the cron.schedule entries.
--
-- Run AFTER schema.sql, and only once the app is deployed against the new
-- project — the inbox-danger job starts calling the URL a minute later.
--
-- Deliberately absent: every internal_* job. Those belong to the parent
-- (nahgz) app; internal_cron.call_endpoint reads cron_base_url from the parent's
-- Vault, so scheduling it here would have Kiara's database calling another
-- product's deployment. `internal_cron` is dropped by build/prune.sql.

\set ON_ERROR_STOP on

-- 1. Vault. kiara_cron_secret MUST equal Vercel's CRON_SECRET on the Kiara
--    project, and kiara_cron_base_url must be the deployment the engine feeds.
--    Replace both placeholders before running.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'kiara_cron_base_url') then
    perform vault.create_secret(
      'REPLACE_WITH_KIARA_BASE_URL',
      'kiara_cron_base_url',
      'Base URL for Kiara Chat cron HTTP calls'
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'kiara_cron_secret') then
    perform vault.create_secret(
      'REPLACE_WITH_CRON_SECRET',
      'kiara_cron_secret',
      'Shared secret for Kiara /api/cron/* endpoints'
    );
  end if;
end
$$;

-- 2. The two Kiara jobs, matching the source project exactly.
select cron.schedule(
  'kiara-inbox-danger',
  '* * * * *',
  $job$select kiara_private.call_kiara_endpoint('/api/cron/inbox-danger', 'GET');$job$
);

select cron.schedule(
  'kiara-field-reminders',
  '*/5 * * * *',
  $job$select kiara_private.enqueue_field_reminders();$job$
);

-- 3. Verify. `succeeded` in cron.job_run_details only means pg_net accepted the
--    request — it says nothing about what came back. On the source project that
--    gap hid 12,807 consecutive runs that did nothing but fetch a login page.
--    The real outcome lives in net._http_response (~6h retention); the
--    x-matched-path header is what tells the per-minute jobs apart.
--
--   select status_code,
--          headers->>'x-matched-path' as route,
--          left(content, 200)         as body,
--          created
--     from net._http_response
--    order by created desc
--    limit 20;
--
-- A 307 there means /api/cron/inbox-danger is not excluded from the Next proxy
-- matcher (src/proxy.ts) or from publicPrefixes in src/lib/supabase/middleware.ts.
