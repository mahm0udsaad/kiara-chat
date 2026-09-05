-- Drive campaign (استهداف) sends from Supabase, not Vercel Cron.
--
-- pg_cron ticks every 10 minutes and pg_net POSTs to the app's drain endpoint,
-- exactly as kiara-field-reminders POSTs to Expo. The endpoint authenticates
-- with CRON_SECRET, so the secret must NOT live in this committed file — it is
-- read from Supabase Vault. Add it once (Dashboard → Project Settings → Vault,
-- or SQL) before this schedule can authenticate:
--
--   select vault.create_secret('<YOUR_CRON_SECRET>', 'cron_secret');
--
-- The endpoint sends up to the number's remaining daily allowance each tick, so
-- a few early ticks spend the day's cap and the rest are quick no-ops.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job
  where jobname = 'kiara-campaigns-drain' limit 1;
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'kiara-campaigns-drain',
    '*/10 * * * *',
    $command$
      select net.http_post(
        url := 'https://kiara-chat-eight.vercel.app/api/cron/campaigns-drain',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        timeout_milliseconds := 55000
      );
    $command$
  );
end
$$;

-- Verify:  select jobname, schedule, active from cron.job where jobname = 'kiara-campaigns-drain';
-- Remove:  select cron.unschedule('kiara-campaigns-drain');
