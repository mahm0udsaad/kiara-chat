#!/usr/bin/env bash
# Phase 2 — capture the source schema and stage it for the dedicated project.
#
# pg_dump is used rather than hand-written DDL because the migration ledger on
# nkdkqgrkyqpjdaifazwn is stale: schema_migrations stopped at 20260728232114
# while the database moved well past it. The live catalogue is the only honest
# description of production.
#
# Produces:
#   build/schema.sql  — public + kiara_private, structure only
#   build/prune.sql   — drops the parent-app tables Kiara does not use
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/.env.migration"
: "${SOURCE_DB_URL:?Set SOURCE_DB_URL in .env.migration}"

mkdir -p "$HERE/build"

echo "==> dumping public + kiara_private (structure only)"
# --no-owner is right (the target's owning roles differ), but privileges must be
# kept. RLS policies decide which ROWS a role may see; they grant no access to
# the table itself. Without the GRANTs to anon/authenticated/service_role,
# PostgREST answers "permission denied for table" on every request while every
# policy looks perfectly correct.
pg_dump "$SOURCE_DB_URL" \
  --schema-only \
  --no-owner --no-comments \
  --schema=public --schema=kiara_private \
  --file "$HERE/build/schema.sql"

echo "    $(wc -l < "$HERE/build/schema.sql") lines"

# Supabase ships a `public` schema on every new project, so the dump's bare
# CREATE SCHEMA public aborts the load on line 33. kiara_private is genuinely
# new, but making both idempotent keeps the file re-runnable.
sed -i '' \
  -e 's/^CREATE SCHEMA public;$/CREATE SCHEMA IF NOT EXISTS public;/' \
  -e 's/^CREATE SCHEMA kiara_private;$/CREATE SCHEMA IF NOT EXISTS kiara_private;/' \
  "$HERE/build/schema.sql"
echo "    made CREATE SCHEMA idempotent"

# Dumping both schemas whole is deliberate: it guarantees every function,
# trigger and RLS policy Kiara's code paths reach comes across, including ones
# nobody remembered. The parent-only tables are then dropped explicitly, which
# is far safer than trying to enumerate the keep set for pg_dump -t and
# discovering a missing dependency at runtime.
#
# The 37-table keep set was derived by scanning every retained function body for
# references to tables outside it (see 01-schema-tables.sql for the resulting
# table list and its provenance).
cat > "$HERE/build/prune.sql" <<'SQL'
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
SQL

echo "==> wrote build/prune.sql"
echo
echo "Next:"
echo "  psql \"\$TARGET_DB_URL\" -v ON_ERROR_STOP=1 -f build/schema.sql"
echo "  psql \"\$TARGET_DB_URL\" -v ON_ERROR_STOP=1 -f build/prune.sql"
echo "  ./copy-data.sh && ./verify.sh"
