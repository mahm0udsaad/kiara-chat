-- Parent-app (nahgz) tables. Kiara has zero rows in all of them, and no Kiara
-- code path or retained function references any.
BEGIN;
DROP TABLE IF EXISTS public.marketing_campaigns        CASCADE;
DROP TABLE IF EXISTS public.marketing_templates        CASCADE;
DROP TABLE IF EXISTS public.campaign_recipients        CASCADE;
DROP TABLE IF EXISTS public.campaign_send_jobs         CASCADE;
DROP TABLE IF EXISTS public.template_approval_polls    CASCADE;
DROP TABLE IF EXISTS public.meta_ads_connections       CASCADE;
DROP TABLE IF EXISTS public.nehgz_hub_connections      CASCADE;
DROP TABLE IF EXISTS public.nehgz_webhook_events       CASCADE;
DROP TABLE IF EXISTS public.twilio_status_events       CASCADE;
DROP TABLE IF EXISTS public.provisioning_runs          CASCADE;
DROP TABLE IF EXISTS public.access_requests            CASCADE;
DROP TABLE IF EXISTS public.restaurant_members         CASCADE;
DROP TABLE IF EXISTS public.opt_outs                   CASCADE;
DROP TABLE IF EXISTS public.push_broadcast_log         CASCADE;
DROP TABLE IF EXISTS public.agent_instructions         CASCADE;
DROP TABLE IF EXISTS public.team_member_goals          CASCADE;
DROP TABLE IF EXISTS public.team_member_notes          CASCADE;
DROP TABLE IF EXISTS public.customer_satisfaction_analyses CASCADE;
DROP TABLE IF EXISTS public.ai_kill_switch_log         CASCADE;
DROP TABLE IF EXISTS public.ai_usage                   CASCADE;
DROP TABLE IF EXISTS public.ai_reply_jobs              CASCADE;
DROP TABLE IF EXISTS public.webhook_events             CASCADE;

-- Kiara's own 2026-07-25 archive snapshots — already superseded by the live
-- tables; keeping them would migrate a stale copy of the same conversations.
DROP TABLE IF EXISTS public.kiara_archive_conversations_20260725     CASCADE;
DROP TABLE IF EXISTS public.kiara_archive_messages_20260725          CASCADE;
DROP TABLE IF EXISTS public.kiara_archive_notes_20260725             CASCADE;
DROP TABLE IF EXISTS public.kiara_archive_orders_20260725            CASCADE;
DROP TABLE IF EXISTS public.kiara_archive_team_members_20260725      CASCADE;
DROP TABLE IF EXISTS public.kiara_archive_claim_events_20260725      CASCADE;
DROP TABLE IF EXISTS public.kiara_archive_label_assignments_20260725 CASCADE;

-- The parent app's cron caller. Kiara has its own (kiara_private), and leaving
-- this one behind would point Kiara's scheduled work at nahgz's host.
DROP SCHEMA IF EXISTS internal_cron CASCADE;
COMMIT;
