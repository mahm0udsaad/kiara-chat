# Handover — Kiara Supabase migration

You are taking over a database migration already in progress. Read this whole
file before running anything. Repo: `/Users/mahmoudmac/Documents/projects/kiara-chat`.

---

## 0. READ FIRST — production is currently down

The Vercel production app (`https://kiara-chat-eight.vercel.app`) has its env
vars pointed at **`wemcvpgyzmcvbwvaxxjd`** — an **abandoned, empty** Supabase
project. It has no schema and no users, so every request fails and login returns
"بيانات الدخول غير صحيحة". This is not a data-loss event: the real data is safe
in two other projects. It is a wrong-pointer event.

Verified by reading the deployed JS bundle: it ships
`https://wemcvpgyzmcvbwvaxxjd.supabase.co` + `sb_publishable_wTRV83UU6GMzG…`.

**Fixing this is the highest-priority task.** See §5.

---

## 1. The three projects — do not confuse them

| role | ref | region | state |
|---|---|---|---|
| **SOURCE** (old, shared) | `nkdkqgrkyqpjdaifazwn` | eu-central-1 | Live, untouched. Shared multi-tenant DB with the parent "nahgz" app. **Never write to it.** |
| **TARGET** (correct, new) | `ugbplqgrheovlfgolsjf` | eu-central-1 | Migrated + verified. This is the one to go live on. Project name `kiara-chat`. |
| **ABANDONED** | `wemcvpgyzmcvbwvaxxjd` | ap-south-1 | Empty except storage. Delete once prod is fixed. Prod currently points here. |

**Why the third one was abandoned:** it was created in Mumbai while Vercel runs
in `fra1` (Frankfurt) — confirmed via `x-vercel-id: fra1::…`, and there is no
`vercel.json` pinning regions. That is ~110–130 ms per query instead of ~1–3 ms.
This codebase is tuned at the millisecond level (`src/lib/tenant.ts` runs two
lookups concurrently precisely to avoid serial round trips), so a page doing 4–5
sequential queries would go from ~10 ms to ~500 ms of DB time. **Any replacement
project must be in eu-central-1.**

---

## 2. Credentials — already on disk, gitignored

All under `supabase/migration/`, covered by root `.gitignore` (`.env*`):

- `.env.migration` — source + target DB URLs, target service/publishable keys, `KIARA_RESTAURANT_ID`
- `.env.token` — Supabase personal access token (management API)
- `.env.newproject` — the generated DB password for the new project

`.env.local.bak-preflip` in the repo root is the pre-migration copy of
`.env.local`. The live `.env.local` has already been repointed to the new
Frankfurt project.

**Never print these values into chat.** They are read by the scripts directly.

### Connection gotchas that cost real time — do not rediscover them

1. `db.<ref>.supabase.co` is **IPv6-only** and this Mac has no IPv6 route. psql
   fails with "could not translate host name". **Always use the session pooler.**
2. Shape: `postgresql://postgres.<ref>:<pw>@aws-N-<region>.pooler.supabase.com:5432/postgres`
3. The **N differs per project**: SOURCE is on `aws-1`-eu-central-1, TARGET is on
   `aws-0`-eu-central-1. The wrong one answers but rejects with
   `ENOTFOUND tenant/user`.
4. Port **5432 = session mode**, required. Transaction mode (6543) breaks
   `pg_dump` and `\copy`.
5. Passwords with `@` must be percent-encoded (`%40`) or libpq parses the
   remainder as the hostname. The source password has one; the generated target
   password is deliberately alphanumeric.
6. `timeout` does not exist on macOS — use `PGCONNECT_TIMEOUT=25`.

---

## 3. What is DONE and VERIFIED on `ugbplqgrheovlfgolsjf`

Do not redo these. Re-verify cheaply with `./verify.sh`.

- **Schema**: 37 tables after prune, 82 policies, 195 indexes, 22 triggers,
  RLS on every table, 269 grants to anon/authenticated/service_role.
- **Data**: all 31 checked tables match source exactly — 6,083 messages,
  676 customers, 183 conversations, 225 knowledge_chunks, 101 menu_items,
  195 rekaz_reservations, 5 auth.users. `./verify.sh` prints "row counts match."
- **Storage**: `whatsapp-media`, 1,056 objects / 93.20 MB, verified
  object-by-object on size. 0 missing, 0 mismatches.
- **Auth**: all 5 users present and confirmed, `encrypted_password` carried over
  verbatim — existing passwords work. Verified live: `hanan@kiara.com` /
  `kiara@26` returns a valid JWT from the new project.
- **RPCs**: `match_knowledge_chunks` returns a 1.0000 self-match over 5 hits
  (pgvector + ivfflat + RPC all functional); `mobile_inbox_list` returns rows.
- **Realtime**: publication has the 5 source tables
  (conversations, messages, orders, conversation_claim_events, agent_shifts) and
  the `kiara_mobile_receive_employee_inbox` policy exists on `realtime.messages`.
- **JWT**: ES256 asymmetric signing is `in_use` by default, so
  `auth.getClaims()` local verification works. No action needed.
- **Local app test**: with `.env.local` repointed, `hanan@kiara.com` logs in and
  `/inbox` returns 200 with cookie `sb-ugbplqgrheovlfgolsjf-auth-token`.

### Traps already hit — they are fixed in the scripts, don't reintroduce them

- `pg_dump --no-privileges` produced a schema with correct RLS and **zero
  grants**. Everything looks right and PostgREST answers "permission denied" on
  every request. Privileges are now kept.
- `pg_dump --schema=public --schema=kiara_private` emits **no `CREATE
  EXTENSION`** — the extensions live in the `extensions` schema. The dump
  references `extensions.vector(768)` 21 times. Hence `00-extensions.sql`, which
  must run first.
- `auth.users.confirmed_at` is a **generated column**. `SELECT *` yields 35
  fields but `COPY … FROM` expects 34, failing with "extra data after last
  expected column" — which reads like GoTrue schema drift and is not. All copies
  now use explicit column lists.
- Supabase ships a `public` schema, so the dump's bare `CREATE SCHEMA public`
  aborts the load. `dump-schema.sh` rewrites it to `IF NOT EXISTS`.
- `\copy` is a psql meta-command and must be on **one line**. A multi-line SQL
  filter silently becomes broken.
- 20 `ALTER DEFAULT PRIVILEGES` statements fail (the pooler role cannot set them
  for `supabase_admin`). **This is benign** — they affect future objects only.

---

## 4. Files in `supabase/migration/`

| file | purpose |
|---|---|
| `README.md` | full runbook, scope rationale, cutover plan |
| `00-extensions.sql` | extensions; must run before the schema |
| `dump-schema.sh` | `pg_dump` of public + kiara_private → `build/schema.sql`, and generates `build/prune.sql` |
| `copy-data.sh` | auth users + all rows, FK order, explicit column lists, idempotent (truncates each target table first) |
| `copy-storage.mjs` | media copy, service keys only, resumable, self-verifying |
| `realtime.sql` | publication membership + mobile broadcast policy |
| `cron.sql` | Vault secrets + the two `kiara-*` jobs — **not yet applied** |
| `verify.sh` | per-table source↔target counts + structural checks |
| `01-schema-tables.sql` | reference only, documents the 37-table scope. Not applied. |

Everything is re-runnable. Nothing writes to SOURCE.

---

## 5. Remaining work, in order

### 5.1 Restore production (urgent)
Set these on the Vercel project (values in `.env.migration`):
- `NEXT_PUBLIC_SUPABASE_URL` → `https://ugbplqgrheovlfgolsjf.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → the target **publishable** key (`sb_publishable_…` is a drop-in for the legacy anon key)
- `SUPABASE_SERVICE_ROLE_KEY` → the target service key
- `KIARA_RESTAURANT_ID` → unchanged (`2ba8f6c8-aff9-4147-8f13-cdcb732de698`)

There is no Vercel CLI or token on this machine — the user must apply these, or
supply a token. Then redeploy and confirm the deployed bundle no longer
references `wemcvpgyzmcvbwvaxxjd`.

**Decide with the user first:** flipping prod to the new project means any
WhatsApp messages that landed on the SOURCE project since the last `copy-data.sh`
run stay behind. Freeze the VPS engine, re-run `./copy-data.sh` for the delta,
`./verify.sh`, then flip. See README §Cutover.

### 5.2 Apply `cron.sql` — only after the app is deployed and reachable
It has two `REPLACE_WITH_…` placeholders: the base URL and `CRON_SECRET`. The
secret must match Vercel's `CRON_SECRET` exactly or every call 401s.
**Verify actual outcomes in `net._http_response`, not `cron.job_run_details`** —
`succeeded` there only means pg_net enqueued the request. On the source project
that gap hid 12,807 consecutive runs that did nothing but fetch a login page.
Check `status_code` and `headers->>'x-matched-path'`.

### 5.3 Mobile — needs a store release, cannot be hot-fixed
OTA is **disabled**: `EXUpdatesEnabled=false`
(`apps/mobile/ios/KiaraOperations/Supporting/Expo.plist`) and
`expo.modules.updates.ENABLED=false` (`android/…/AndroidManifest.xml`), no update
URL in either. `expo-updates` is installed but inert.

The app has **no direct table access** — all data goes through
`EXPO_PUBLIC_API_URL` to the Next app. Supabase is used only for **auth** and
**realtime**. So at cutover, phones hold JWTs signed by the old project: every
API call 401s and the live inbox goes silent. Only
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` change,
and only a new binary can carry them.

Audience is ~5 people, so this is a coordinated same-day update, not a rollout.
**Submit and get approval before flipping the backend.** Turn OTA on
(`eas update:configure`) in that same build.

### 5.4 Cleanup
- Delete `wemcvpgyzmcvbwvaxxjd` once prod is confirmed on the new project.
- **Rotate**: the Supabase access token, the SOURCE DB password, and the
  abandoned project's service key — all were pasted into a chat transcript.
- Leave Kiara's rows in the SOURCE project alone for now. Deleting them is a
  separate, irreversible decision and must not be bundled into this work.

---

## 6. Things to know about this codebase

- Kiara stays **a tenant of one**: `KIARA_RESTAURANT_ID` and every row id are
  preserved. `restaurant_id` stays on every table. Do **not** "simplify" it away
  — it would touch every RLS policy, every `kiara_command_*` signature and ~200
  files.
- `supabase/migrations/` **is not a reliable record** of what is deployed. The
  ledger stopped at `20260728232114` while the DB moved well past it. Always read
  the live catalogue.
- There is a local Postgres harness (`supabase/tests/run-db-tests.sh`) but it
  **cannot validate this schema** — pgvector is not installed locally and the
  dump carries an `ivfflat` index.
- The bot brain stops being shared after this migration: `knowledge_chunks`,
  `ai_agents` and `restaurants.ai_enabled` / `ai_schedule_*` were one row shared
  with the parent nahgz app. Each product now has its own copy. This is a product
  change, not just infra — make sure the user knows.
- `whatsapp_numbers` for Kiara is stale: it reads
  `+966593695614 / twilio / customer_owned`, but the live engine is Baileys on
  `+966508421748`. The row is copied only because `restaurants` FKs to it. Do not
  let its contents drive any transport decision.

## 7. Ground rules

- Never write to `nkdkqgrkyqpjdaifazwn`. It serves another live product.
- Confirm with the user before anything irreversible: flipping prod env,
  deleting a project, deleting rows from SOURCE.
- Verify claims rather than reporting them. Row counts alone do not prove a
  migration — check embeddings dimensionality, grants, realtime, and a real login.
