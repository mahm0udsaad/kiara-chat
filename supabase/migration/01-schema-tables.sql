-- Phase 2a — extensions + tables for the dedicated Kiara project.
-- Generated from the live catalogue of nkdkqgrkyqpjdaifazwn (not from
-- supabase/migrations — that ledger is stale and does not describe production).
--
-- Scope: the 37 tables Kiara's code and RPCs actually touch, plus their FK
-- parents. Parent-app-only tables (marketing_*, campaign_*, nehgz_*, twilio_*,
-- meta_ads_connections, provisioning_runs, kiara_archive_*) are deliberately
-- absent. The set was verified by scanning every retained function body for
-- references to tables outside it — that check added agent_shifts and
-- sla_notification_log and nothing else.
--
-- No enums, domains or sequences exist in the source public schema, so there
-- is nothing to create ahead of the tables.

-- Extension schemas mirror the source exactly. citext lives in public there (not
-- extensions) and several policies/indexes resolve it unqualified, so moving it
-- would break them; pg_cron only ever installs into pg_catalog.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE SCHEMA IF NOT EXISTS kiara_private;

CREATE TABLE IF NOT EXISTS public.agent_shifts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  team_member_id uuid NOT NULL,
  starts_at timestamp with time zone NOT NULL,
  ends_at timestamp with time zone NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_by uuid
);

CREATE TABLE IF NOT EXISTS public.ai_agents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  name text DEFAULT 'مساعد المطعم'::text NOT NULL,
  avatar_url text,
  personality text DEFAULT 'friendly'::text,
  system_instructions text DEFAULT ''::text,
  chat_mode text DEFAULT 'text_input'::text,
  language_preference text DEFAULT 'ar'::text,
  off_topic_response text DEFAULT 'عذراً، أنا مساعد المطعم ويمكنني مساعدتك فقط في الاستفسارات المتعلقة بالمطعم والقائمة والطلبات.'::text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  max_context_messages integer DEFAULT 10 NOT NULL,
  temperature numeric(3,2) DEFAULT 0.40 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.client_exports (
  id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  client_name text,
  client_number text,
  status text DEFAULT 'pending_qr'::text NOT NULL,
  counts jsonb,
  archive_path text,
  approved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  ingested_at timestamp with time zone,
  ingest_result jsonb
);

CREATE TABLE IF NOT EXISTS public.command_receipts (
  restaurant_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  command_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  actor_user_id uuid,
  actor_team_member_id uuid,
  actor_field_staff_account_id uuid,
  status text DEFAULT 'in_progress'::text NOT NULL,
  response jsonb,
  error_code text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.conversation_claim_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  team_member_id uuid NOT NULL,
  mode text NOT NULL,
  claimed_at timestamp with time zone DEFAULT now() NOT NULL,
  claimed_by_user_id uuid,
  event_type text DEFAULT 'claim'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.conversation_internal_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  author_user_id uuid,
  body text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.conversation_label_assignments (
  conversation_id uuid NOT NULL,
  label_id uuid NOT NULL,
  assigned_at timestamp with time zone DEFAULT now() NOT NULL,
  assigned_by uuid
);

CREATE TABLE IF NOT EXISTS public.conversation_labels (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  color text DEFAULT 'slate'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  customer_phone text NOT NULL,
  customer_name text,
  status text DEFAULT 'active'::text,
  started_at timestamp with time zone DEFAULT now(),
  last_message_at timestamp with time zone DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  last_inbound_at timestamp with time zone,
  bot_paused boolean DEFAULT false NOT NULL,
  assigned_to uuid,
  assigned_at timestamp with time zone,
  handler_mode text DEFAULT 'unassigned'::text,
  assigned_by_user_id uuid,
  unread_count integer DEFAULT 0 NOT NULL,
  last_read_at timestamp with time zone,
  archived_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  phone_number text NOT NULL,
  full_name text,
  source text DEFAULT 'manual'::text NOT NULL,
  source_ref text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  opted_out boolean DEFAULT false NOT NULL,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.dispatch_settings (
  restaurant_id uuid NOT NULL,
  full_trip_price numeric(10,2) DEFAULT 0 NOT NULL,
  half_trip_price numeric(10,2) DEFAULT 0 NOT NULL,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.driver_orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  specialist_id uuid,
  driver_id uuid,
  arrival_at timestamp with time zone NOT NULL,
  customer_location text NOT NULL,
  customer_phone text NOT NULL,
  duration_minutes integer NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  sent_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  trip_type text DEFAULT 'one_way'::text NOT NULL,
  price numeric(10,2),
  updated_by uuid,
  version bigint DEFAULT 1 NOT NULL,
  dispatch_state text DEFAULT 'idle'::text NOT NULL,
  active_dispatch_command_id uuid,
  dispatch_started_at timestamp with time zone,
  rekaz_source_id text
);

CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.field_location_checkpoints (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  field_staff_account_id uuid NOT NULL,
  action text NOT NULL,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  captured_at timestamp with time zone,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  source text DEFAULT 'device'::text NOT NULL,
  permission_state text,
  exception_reason text
);

CREATE TABLE IF NOT EXISTS public.field_order_progress (
  order_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  driver_confirmed_at timestamp with time zone,
  specialist_pickup_at timestamp with time zone,
  service_started_at timestamp with time zone,
  completed_at timestamp with time zone,
  last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
  last_reminder_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  version bigint DEFAULT 1 NOT NULL,
  driver_arrived_at timestamp with time zone,
  driver_returned_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.field_staff_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  role text NOT NULL,
  specialist_id uuid,
  driver_id uuid,
  is_active boolean DEFAULT true NOT NULL,
  last_app_activity_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.field_staff_push_tokens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  field_staff_account_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  expo_token text NOT NULL,
  device_id text NOT NULL,
  disabled boolean DEFAULT false NOT NULL,
  disabled_reason text,
  last_error_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  title text,
  content text NOT NULL,
  embedding vector(768),
  source_type text DEFAULT 'manual'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  content text NOT NULL,
  embedding vector(768),
  source_file text,
  chunk_index integer,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  description_ar text,
  description_en text,
  price numeric(10,2) NOT NULL,
  discounted_price numeric(10,2),
  currency text DEFAULT 'SAR'::text,
  category text NOT NULL,
  subcategory text,
  image_url text,
  is_available boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  crawled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  message_type text DEFAULT 'text'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  delivery_status text,
  error_message text,
  external_message_sid text,
  twilio_message_sid text,
  twilio_status text,
  external_error_code text,
  channel text DEFAULT 'whatsapp'::text NOT NULL,
  sender_team_member_id uuid
);

CREATE TABLE IF NOT EXISTS public.operation_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_role text,
  actor_user_id uuid,
  actor_team_member_id uuid,
  actor_field_staff_account_id uuid,
  idempotency_key uuid,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  customer_phone text NOT NULL,
  customer_name text,
  type text NOT NULL,
  details text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  admin_note text,
  admin_reply text,
  replied_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  priority text DEFAULT 'normal'::text NOT NULL,
  escalation_reason text,
  assigned_to uuid,
  claimed_at timestamp with time zone,
  ai_draft_reply text,
  ai_draft_generated_at timestamp with time zone,
  hanan_escalated_at timestamp with time zone,
  rekaz_booking_url text,
  extracted_intent jsonb
);

CREATE TABLE IF NOT EXISTS public.outbox_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  command_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  claimed_at timestamp with time zone,
  completed_at timestamp with time zone,
  provider_message_id text,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.owner_ai_manager_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  thread_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.owner_ai_manager_threads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  title text,
  status text DEFAULT 'open'::text NOT NULL,
  last_message_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  expo_push_token text,
  is_super_admin boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rekaz_changes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  sync_run_id uuid NOT NULL,
  source_id text NOT NULL,
  change_type text NOT NULL,
  previous_payload jsonb,
  next_payload jsonb,
  changed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rekaz_reservations (
  restaurant_id uuid NOT NULL,
  source_id text NOT NULL,
  source_order_id text,
  payload_hash text NOT NULL,
  arrival_at timestamp with time zone NOT NULL,
  customer_phone text NOT NULL,
  customer_name text DEFAULT ''::text NOT NULL,
  status text DEFAULT ''::text NOT NULL,
  payload jsonb NOT NULL,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  removed_at timestamp with time zone,
  last_sync_run_id uuid
);

CREATE TABLE IF NOT EXISTS public.rekaz_sync_runs (
  id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  source text DEFAULT 'rekaz'::text NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  actor_user_id uuid,
  actor_team_member_id uuid,
  incoming_count integer DEFAULT 0 NOT NULL,
  added_count integer DEFAULT 0 NOT NULL,
  updated_count integer DEFAULT 0 NOT NULL,
  removed_count integer DEFAULT 0 NOT NULL,
  unchanged_count integer DEFAULT 0 NOT NULL,
  error_code text,
  error_message text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.restaurants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  name_ar text,
  logo_url text,
  country text DEFAULT 'SA'::text,
  currency text DEFAULT 'SAR'::text,
  timezone text DEFAULT 'Asia/Riyadh'::text,
  twilio_phone_number text,
  twilio_account_sid text,
  twilio_auth_token text,
  digital_menu_url text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  primary_whatsapp_number_id uuid,
  provisioning_status text DEFAULT 'draft'::text NOT NULL,
  onboarding_completed_at timestamp with time zone,
  activation_started_at timestamp with time zone,
  activated_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  telephone text,
  opening_hours text,
  cuisine text,
  setup_status text DEFAULT 'draft'::text,
  website_url text,
  ai_enabled boolean DEFAULT true NOT NULL,
  ai_schedule_enabled boolean DEFAULT false NOT NULL,
  ai_schedule_start time without time zone DEFAULT '00:00:00'::time without time zone NOT NULL,
  ai_schedule_end time without time zone DEFAULT '23:59:00'::time without time zone NOT NULL,
  ai_schedule_weekend_24h boolean DEFAULT false NOT NULL,
  ai_schedule_timezone text DEFAULT 'Asia/Riyadh'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.saved_replies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sla_notification_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  notified_at timestamp with time zone DEFAULT now() NOT NULL,
  notification_type text DEFAULT 'sla_breach'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.specialists (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  full_name text NOT NULL,
  phone text,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  nationality text
);

CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'agent'::text NOT NULL,
  full_name text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  is_available boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  team_member_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  expo_token text NOT NULL,
  device_id text,
  platform text,
  last_seen_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  disabled boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.whatsapp_numbers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id uuid,
  phone_number text NOT NULL,
  provider text DEFAULT 'twilio'::text NOT NULL,
  source_type text DEFAULT 'pool'::text NOT NULL,
  is_primary boolean DEFAULT false NOT NULL,
  assignment_status text DEFAULT 'available'::text NOT NULL,
  onboarding_status text DEFAULT 'unclaimed'::text NOT NULL,
  twilio_subaccount_sid text,
  twilio_messaging_service_sid text,
  twilio_whatsapp_sender_sid text,
  meta_business_account_id text,
  meta_waba_id text,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  last_error text,
  assigned_at timestamp with time zone,
  released_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
