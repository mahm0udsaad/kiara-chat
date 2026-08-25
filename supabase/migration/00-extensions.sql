-- Phase 2a — extensions, before build/schema.sql.
--
-- `pg_dump --schema=public --schema=kiara_private` emits no CREATE EXTENSION at
-- all: the extensions live in the `extensions` schema, which was not dumped. The
-- dump still *references* them 21 times — `extensions.vector(768)` on
-- knowledge_chunks/knowledge_base, `extensions.vector_cosine_ops` on the ivfflat
-- index, and `net.http_get`/`net.http_post` inside
-- kiara_private.call_kiara_endpoint. Applying schema.sql without these fails on
-- the first vector column.
--
-- Schemas mirror the source exactly (checked against pg_extension there): citext
-- is in public, not extensions, and pg_cron only ever installs into pg_catalog.

CREATE EXTENSION IF NOT EXISTS pgcrypto   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext     WITH SCHEMA public;

-- Needed by cron.sql, not by the schema. Enabled here so the whole extension
-- surface is established in one place.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- gen_random_uuid() is used by 48 column defaults. It is built into Postgres 13+
-- as well as supplied by pgcrypto, so no separate action is required — but it
-- must resolve, which the search_path below guarantees for later sessions.
ALTER DATABASE postgres SET search_path TO "\$user", public, extensions;
