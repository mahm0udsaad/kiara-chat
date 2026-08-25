# Kiara → dedicated Supabase project

Moving Kiara off the shared `whatsapp-cs` project (`nkdkqgrkyqpjdaifazwn`) onto
its own — **`ugbplqgrheovlfgolsjf`** (`kiara-chat`, eu-central-1, its own Supabase
account) — so it stops sharing a CPU budget with the parent (nahgz) app.

A first attempt used `wemcvpgyzmcvbwvaxxjd`, which was created in ap-south-1 and
abandoned for the region reason below. Delete it once this is live, so nobody
later points an env var at a half-populated database.

Kiara stays **a tenant of one**: `KIARA_RESTAURANT_ID` keeps the same UUID, every
row keeps its id, and `restaurant_id` stays on every table. Nothing in `src/` or
`apps/mobile/` changes except environment variables. Dropping the tenant column
would touch every RLS policy, every `kiara_command_*` signature and ~200 files
for no operational gain.

## What moves

37 tables. Derived from the live catalogue, not from `supabase/migrations` —
that ledger stopped at `20260728232114` while the database moved well past it.
The keep set was then checked by scanning every retained function body for
references to tables outside it, which added `agent_shifts` and
`sla_notification_log` and nothing else.

| | rows |
|---|---|
| conversations / messages | 183 / 6,083 |
| customers | 676 |
| menu_items (the services) | 101 |
| knowledge_chunks / knowledge_base | 225 / 8 |
| specialists / drivers | 5 / 2 |
| team_members / field_staff_accounts | 2 / 2 |
| rekaz_reservations / _changes / _sync_runs | 195 / 248 / 3 |
| conversation_labels / assignments | 7 / 21 |
| ai_agents (bot personality + instructions) | 1 |
| saved_replies | 1 |
| driver_orders / orders / field_order_progress | 19 / 2 / 4 |
| command_receipts / outbox_events / operation_events | 10 / 6 / 16 |
| auth.users | 5 |
| storage `whatsapp-media` | 1,056 objects / 93 MB |

**Not moved:** `sla_notification_log` (36,516 log rows), `webhook_events`,
`twilio_status_events`, every `marketing_*` / `campaign_*` / `nehgz_*` table
(zero Kiara rows), and the seven `kiara_archive_*_20260725` snapshots
(superseded by the live tables). Schema-only for `sla_notification_log`, which
`team_performance()` reads.

## Order

| | step | needs |
|---|---|---|
| 1 | `node copy-storage.mjs` | service keys only ✅ |
| 2 | `./dump-schema.sh` | `SOURCE_DB_URL` ✅ |
| 3 | `psql -f 00-extensions.sql`, then `build/schema.sql`, then `build/prune.sql` | `TARGET_DB_URL` ✅ |
| 4 | `psql "$TARGET_DB_URL" -f realtime.sql` | ✅ |
| 5 | `./copy-data.sh` | both ✅ |
| 6 | `./verify.sh` | both ✅ all 31 tables match |
| 7 | `psql "$TARGET_DB_URL" -f cron.sql` | after the app is deployed |
| 8 | flip env, redeploy, ship mobile | |

Steps 2–7 are safe to repeat: `copy-data.sh` truncates each target table before
loading it, and nothing writes to the source at any point.

## The target project must be in eu-central-1

Non-negotiable, and the reason the first target was abandoned.

The Vercel deployment runs in **fra1** (Frankfurt) — confirmed from
`x-vercel-id: fra1::…` on kiara-chat-eight.vercel.app, and there is no
`vercel.json` or region pin to change it. The source database is in
eu-central-1, so today every query is same-city, ~1–3 ms.

The first target (`wemcvpgyzmcvbwvaxxjd`) was created in **ap-south-1**
(Mumbai): ~110–130 ms per round trip from fra1. This codebase is tuned at the
millisecond level — `src/lib/tenant.ts` runs its two lookups concurrently
specifically to avoid "two serial round trips on every request", and
`createServerSupabaseClient` is memoized per request for the same reason. At
Mumbai latency a page doing 4–5 sequential queries goes from ~10 ms of database
time to ~500 ms, which is a far worse outcome than the CPU contention this
migration exists to escape.

Put the project in **eu-central-1**, same region as Vercel. If the deployment
region ever changes, move the database with it.

## Before step 2

Fill `SOURCE_DB_URL` and `TARGET_DB_URL` in `.env.migration` (gitignored).
Dashboard → Settings → Database → Connection string.

**Use the session pooler, not the direct connection.** `db.<ref>.supabase.co`
resolves to an AAAA record only, and this machine has no IPv6 route, so psql
fails with "could not translate host name". The working shape is:

    postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres

Two things that cost time here: the source project is on **aws-1**-eu-central-1,
not aws-0 (aws-0 answers, but with `ENOTFOUND tenant/user`), and a password
containing `@` must be percent-encoded as `%40` or libpq parses the rest of it
as the hostname. Port 5432 is session mode — required, because `pg_dump` and
`\copy` do not work through transaction mode (6543).

Also enable on the target, in the dashboard:

- **Asymmetric JWT signing keys (ES256).** Needed by `auth.getClaims()` in
  `src/lib/tenant.ts` for local token verification. New projects now ship with
  ES256 `in_use` by default — verified on this one, no action required.
- Extensions are NOT in the pg_dump (it only covers public + kiara_private, and
  they live in `extensions`). `00-extensions.sql` installs them and must run
  first.

## Cutover (step 8)

1. Stop the VPS engine (`kiara-wa-service`) so no message arrives mid-flight.
2. Re-run `./copy-data.sh` for the delta, then `./verify.sh`.
3. Vercel env on the Kiara project:
   - `NEXT_PUBLIC_SUPABASE_URL` → the new project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → the new **publishable** key
     (`sb_publishable_…` is a drop-in for the legacy anon key)
   - `SUPABASE_SERVICE_ROLE_KEY` → the new service key
   - `KIARA_RESTAURANT_ID` unchanged
4. Redeploy, restart the engine, run `cron.sql`.
5. Mobile: EAS env `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   Inlined at bundle time, and OTA is disabled — this needs a store release, so
   submit it *before* step 3. See the first open item.

## Open items

- **Mobile needs a store release — OTA is not available.** Settled by reading the
  native projects: `EXUpdatesEnabled=false` (`ios/KiaraOperations/Supporting/Expo.plist`)
  and `expo.modules.updates.ENABLED=false` (`android/app/src/main/AndroidManifest.xml`),
  with no update URL configured in either. `expo-updates` is installed but inert,
  so no `eas update` can reach a shipped build.

  The break surface is narrow but fatal. The app has **no direct table access** —
  every read and write goes through `EXPO_PUBLIC_API_URL` to the Next app, which
  moves with the flip. Supabase is used for exactly two things:
  - **auth** (`signInWithPassword`, `getSession`, `onAuthStateChange`) — phones
    hold JWTs signed by the old project, and the Next API will be validating
    against the new one, so every request 401s;
  - **realtime** (`supabase.channel`, `realtime.setAuth`) — the live inbox goes quiet.

  `EXPO_PUBLIC_API_URL` does not change. Only `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` do, and only a new binary can carry them.

  This is manageable because the audience is ~5 people (2 team members, 2 field
  staff, the owner), not a public install base: submit the new build first, wait
  for approval, then flip the backend and have everyone update the same day.
  Turn OTA on in that same build (`eas update:configure`) so the next such
  change never needs a store round trip again.
- **`whatsapp_numbers` is stale.** Kiara's row reads
  `+966593695614 / twilio / customer_owned`, but the live engine is Baileys on
  `+966508421748`. The row is copied because `restaurants` has an FK to it —
  do not let its contents drive any transport decision.
- **The bot brain stops being shared.** `knowledge_chunks`, `ai_agents` and the
  `ai_enabled` / `ai_schedule_*` columns were one row shared with nahgz. After
  the split each product has its own copy: nahgz edits no longer reach Kiara,
  and Kiara's settings no longer toggle nahgz. That is a product change, not
  just an infra one.
- **Rotate the service-role key** on the new project once cutover is done — it
  was pasted into a chat transcript.
- **Old project cleanup** is deliberately not scripted. Leave Kiara's rows in
  place until the new project has run clean for a while; deleting them is a
  separate, irreversible decision.

## Files

| | |
|---|---|
| `copy-storage.mjs` | media copy, service keys only, resumable |
| `dump-schema.sh` | `pg_dump` of public + kiara_private, plus the prune list |
| `copy-data.sh` | auth users then rows, in FK order, over `\copy` |
| `realtime.sql` | publication membership + the mobile broadcast policy |
| `cron.sql` | Vault secrets + the two `kiara-*` jobs |
| `verify.sh` | per-table source/target counts + structural checks |
| `01-schema-tables.sql` | reference: the 37-table scope, generated from the live catalogue. Not applied — `build/schema.sql` from `pg_dump` is the real artifact |
