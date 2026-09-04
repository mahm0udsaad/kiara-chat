# Kiara Mobile CRM — Engineering Handoff

Handoff date: 2026-08-11  
Repository: `/Users/mahmoudmac/Documents/projects/kiara-chat`  
Primary plan: `docs/mobile-crm-production-plan.md`

## 1. Read this first

1. Read the repository `AGENTS.md` instructions supplied by the workspace.
2. Read `docs/mobile-crm-production-plan.md` completely.
3. Read this handoff completely before editing.
4. Run `git status --short` before doing anything.
5. Preserve the entire dirty worktree. It contains user-owned and prior-agent work.
6. Do not use reset, checkout, clean, or any command that discards changes.
7. Do not push or apply production migrations until staging verification passes and the user authorizes that deployment step.

The mandatory confirmation convention is especially important: any action that sends customer-, driver-, or specialist-facing content must show the exact final content, editable, before the commit. Automatic links/images/additions must be shown before confirmation.

## 2. Product intent

Kiara needs a mobile-first Arabic RTL CRM that feels as simple as WhatsApp while preventing employees from interrupting or overwriting one another.

The system must support:

- Customer-service conversation claiming, SLA danger, follow-ups, booking stages, reservations, dispatch and customer history.
- Calendar-first Rekaz reservations with an accurate pending-change banner and explicit pull action.
- Driver and specialist assignment, push, sequential confirmations, timestamps and location evidence.
- Owner reports for `hanan@kiara.com` that identify what failed, who owned it at the time and the supporting evidence.
- On-demand AI satisfaction and next-best-service recommendations, with package image and editable message draft.
- Deterministic operational facts first; AI explains facts but does not invent accountability metrics.

## 3. Current worktree warning

The worktree was already heavily dirty before this implementation pass and remains so. It includes mobile inbox/push/field work, web inbox/order work and migrations from earlier turns.

Do not assume every dirty file was created by the most recent agent. Review overlapping changes carefully.

No commit or push was performed in the most recent pass. No database migration was applied by that pass.

## 3b. Database verification pass — 2026-08-11 (later the same day)

### Where the migrations actually stand

`supabase_migrations.schema_migrations` in production stops at `20260728232114`,
but the database itself has moved past it. Verified read-only:

| Migration | In the ledger | Present in production |
|---|---|---|
| `20260811113000_field_staff_mobile_workflow` | no | **yes** — all three tables exist |
| `20260811120000_field_reminders_supabase_cron` | no | **yes** — `pg_cron`, `pg_net` and the reminder function exist |
| `20260811142134_secure_mobile_inbox_realtime` | no | no |
| `20260811150941_operational_command_foundation` | no | no |
| `20260811152516_rekaz_delta_sync` | no | no |

Two migrations were applied out of band, so the ledger cannot be trusted as the
record of what is deployed. `driver_orders` still has no `version`,
`dispatch_state` or `active_dispatch_command_id`, which is why the uncommitted
command work is not deployable yet.

### How it was verified

No staging Supabase project exists on the account, and creating a project or a
branch spends money, so verification ran against a throwaway local Postgres 17
database instead: `./supabase/tests/run-db-tests.sh`. It builds Supabase's
roles, `auth`/`realtime` schemas, default privileges and the production table
structure, then applies every pending migration from zero and runs the matrix
in section 8.

Result: **7 migrations apply cleanly from zero; 149 assertions and 11
concurrency scenarios pass.**

What this harness cannot prove, and what still needs a hosted environment:

- PostgREST exposure (it tests SQL-level `GRANT`s, not the Data API surface)
- real GoTrue JWT claims behind `auth.uid()`
- `pg_cron` firing and `pg_net` delivery — both are stubbed
- the `realtime.messages` policy against the live Realtime service

### Defects the verification found

1. **`field_staff_push_tokens_expo_check` rejects every real Expo token.** The
   pattern was written `\\[`, which under `standard_conforming_strings = on`
   demands a literal backslash. Confirmed against production, which evaluates
   `'ExponentPushToken[abc123XYZ]' ~ <shipped pattern>` as false and holds zero
   rows. **This constraint is already live**, so field-staff push registration
   is currently broken in production. Fixed in `20260811113000` for a from-zero
   apply and repaired on an existing database by
   `20260811193000_fix_field_push_token_check.sql`.
2. **Rekaz removals were unbounded.** `fetchRekazReservations()` reads a rolling
   window (yesterday .. +60 days), but the apply judged absence against every
   stored row, so each sync tombstoned the previous day's bookings and invented
   removals in the banner and the change history. `kiara_apply_rekaz_snapshot`
   now takes the window it was fetched for and scopes removal to it.
3. **The location-evidence CHECK accepted unverifiable evidence.** A CHECK
   passes when it evaluates to NULL, so `source = 'manual_exception'` with a
   NULL reason — and `source = 'device'` with no coordinates — were both stored
   as valid. Rewritten as a `CASE`, which cannot be NULL.

### Accountability fixes for the owner role (2026-08-11)

Two holes found while testing what Hanan (`hanan@kiara.com`, admin, active,
7 conversations assigned to her personally) actually gets. Both are closed.

**Replies into a colleague's conversation require an explicit takeover with a reason.** Both reply
routes previously skipped the assignment check for admins
(`session.role !== "admin" && ...`), so an admin could reply into another
employee's thread with no takeover, no reason and no event — the exact
intervention §4.2 and the §7 table say must be recorded. The rule now lives in
one place, `src/lib/conversation-reply-access.ts`, used by the web and mobile
routes so they cannot drift again:

- assigned to me → allowed
- unassigned → `CONVERSATION_NOT_TAKEN` for everyone, admins included
- assigned to someone else, active employee/admin → `TAKEOVER_REQUIRED` (409)

`POST /api/{,mobile/v1/}conversations/:id/takeover` performs the override.
Reason is mandatory (3–500 chars) and lands on a `conversation.taken_over`
event alongside the previous assignee. Since 2026-09-04, any active employee
may use this rescue flow when the current owner is absent. The dedicated
`take_over_conversation` command locks the row, verifies active membership,
compares the owner the caller saw, reassigns it, and writes both assignment and
operation audit events in one transaction.

**`operation_events.actor_role` records the role at action time.** `actor_type`
only says whether a team-member id was supplied, so admin and agent actions
were both `'team_member'`; a report had to join `team_members` as it stands
*today* to say "an admin did this", which silently re-attributes history
whenever somebody is promoted, demoted or deactivated. Every command now
persists the role it was already given — `admin`/`agent` for order and Rekaz
commands, `driver`/`specialist` for field steps, `system` for the dispatch
worker. A test demotes the actor and asserts her old events are unchanged.

### Design changes made on that evidence

- The Rekaz adapter now **keeps cancelled rows** and returns the window it
  fetched. A cancellation is a status update, not a disappearance; display
  surfaces filter cancelled rows instead.
- `driver_orders.rekaz_source_id` (`20260811194500`) replaces phone-plus-day
  matching with a durable link, under a per-tenant partial unique index so two
  employees tapping `طلب سائق` produce one order.

## 4. Verification status at handoff

These commands pass at handoff:

```bash
npx tsc --noEmit
cd apps/mobile && npm run typecheck
npm run lint
git diff --check
```

The root and mobile TypeScript projects compile, ESLint passes and there are no whitespace errors.

Database verification is still outstanding:

- Supabase CLI installed locally: `2.78.1`; it reports a newer `2.113.0` version.
- Docker is not installed, so local Supabase/Postgres could not be started.
- The new migrations have not been executed against staging.
- Supabase's July 2026 breaking change locks the managed `realtime` schema. RLS policies remain allowed, but schema `ALTER` operations do not.

## 5. What was implemented in the latest pass

### 5.1 Realtime migration correction

File:

- `supabase/migrations/20260811142134_secure_mobile_inbox_realtime.sql`

The prohibited line below was removed:

```sql
alter table realtime.messages enable row level security;
```

The migration now only creates the scoped authorization policy. Verify it against staging before applying.

### 5.2 Operational command and audit foundation

New migration:

- `supabase/migrations/20260811150941_operational_command_foundation.sql`

It adds:

- `driver_orders.version`
- `driver_orders.dispatch_state`
- active dispatch command tracking
- `field_order_progress.version`
- `command_receipts`
- append-only `operation_events`
- `outbox_events`
- `field_location_checkpoints`
- service-role-only database functions for:
  - conflict-safe order edit
  - dispatch preparation
  - outbox claim
  - dispatch completion
  - sequential field step

New server wrapper:

- `src/lib/operational-commands.ts`

The command contract uses:

- `expectedVersion`
- UUID `idempotencyKey`
- authenticated actor identity
- database row locking/version checks
- append-only event creation
- outbox persistence
- HTTP `409` mapping for operational conflicts

Important: the migration is additive but unexecuted. Do not trust it until it passes staging SQL, grant, RLS and concurrency tests.

### 5.3 Conflict-safe order editing

Updated:

- `src/lib/dispatch.ts`
- `src/app/api/orders/[id]/route.ts`
- `src/app/api/mobile/v1/orders/[id]/route.ts`
- `src/components/orders-client.tsx`
- `apps/mobile/app/(app)/(tabs)/orders/[id]/edit.tsx`
- `apps/mobile/lib/queries.ts`
- shared/mobile order types

Web and mobile now send the order version and an idempotency key. The server command rejects stale edits rather than overwriting a newer employee change.

### 5.4 Safe two-step dispatch and true confirmation

New preview endpoints:

- `src/app/api/orders/[id]/dispatch/preview/route.ts`
- `src/app/api/mobile/v1/orders/[id]/dispatch/preview/route.ts`

Updated:

- `src/lib/dispatch.ts`
- web and mobile dispatch routes
- `src/components/dispatch-dialog.tsx`
- `apps/mobile/app/(app)/(tabs)/orders/[id]/dispatch.tsx`

Current flow:

1. Choose specialist/driver and enter Arabic specialist instructions.
2. Server generates full driver content and translated specialist content.
3. User sees both exact final messages.
4. Both are editable.
5. Automatic app additions are displayed.
6. Confirmed text is stored in the outbox.
7. Only one caller can claim an outbox event.
8. Dispatch completion updates the order and audit event.

Crash policy is intentionally conservative: if the process crashes after provider acceptance but before completion, the dispatch remains processing for explicit review instead of being blindly resent and risking duplicate WhatsApp messages.

### 5.5 Field progression race protection

Updated:

- `src/lib/field-staff.ts`
- `src/app/api/mobile/v1/field/orders/[id]/route.ts`
- `apps/mobile/app/field/orders/[id].tsx`
- field types/query mutation

The field action sends `expectedVersion` and `idempotencyKey`; the database function enforces role, assignment and sequence.

A prior analytics defect was removed: simply opening/listing a field order no longer changes `field_order_progress.last_activity_at`. Reads cannot postpone reminders or make inactivity look like activity.

### 5.6 Rekaz normalized delta foundation

New migration:

- `supabase/migrations/20260811152516_rekaz_delta_sync.sql`

New server module:

- `src/lib/rekaz-sync.ts`

Updated sync endpoint:

- `src/app/api/reservations/sync/route.ts`

It introduces:

- `rekaz_sync_runs`
- `rekaz_reservations`
- `rekaz_changes`
- tenant advisory lock
- normalized payload SHA-256 hashes
- added/updated/removed/unchanged counts
- an atomic `kiara_apply_rekaz_snapshot` command
- audit event for successful application

`GET /api/reservations/sync` now previews live Rekaz differences. `POST` applies the normalized delta, then still publishes the legacy Storage snapshot for compatibility with existing web rendering.

### 5.7 Web Rekaz pending-change banner

Updated:

- `src/components/rekaz-reservations.tsx`

Changes:

- Calendar is now the default web Rekaz view.
- The page checks Rekaz and can show copy like:
  - `10 تغييرات من ركاز لم يتم سحبها`
- It shows added/updated/removed counts.
- Successful pulls show their actual delta counts.

### 5.8 Mobile calendar API foundation

New endpoint:

- `src/app/api/mobile/v1/orders/calendar/route.ts`

New mobile types/query:

- `OrdersCalendarResponse`
- `RekazReservation`
- `useOrdersCalendar(from, to)`

The endpoint returns Rekaz reservations, visible local orders and last successful sync information for a bounded date range. It prefers normalized database rows and temporarily falls back to the legacy Storage snapshot when the migration is unavailable.

The mobile `/orders` screen has **not yet been switched to this query**. That was the exact next task when work stopped.

## 6. Known limitations and risks that must not be hidden

### Database and SQL

1. Both new migrations require staging execution and correction if PostgreSQL/PostgREST reveals syntax or type issues.
2. Run database advisors after applying.
3. Verify that only `service_role` can execute all `kiara_*` command functions.
4. Verify RLS is enabled and `anon`/`authenticated` have no table access to command/audit/outbox/location/Rekaz workflow tables.
5. Verify migration order: the operational migration depends on the earlier field staff migration.
6. Test idempotency with the same key and key reuse across a different aggregate.
7. Test simultaneous version updates and simultaneous dispatches using two database sessions.

### Dispatch

1. `resendDriverOrder` is still the legacy direct-send path. Move resend onto an idempotent command/outbox before launch.
2. The optional web specialist voice note is sent directly after the outbox text. Store audio in Storage and put a pointer/checksum in an outbox event before calling this launch-safe.
3. Generate and retain one idempotency key per UI submission. The mobile query currently generates the key at mutation time; improve recovery after a lost HTTP response by keeping the key in screen state until a final response is known.
4. Add an admin-only resolution flow for `dispatch_state = processing/uncertain`; require a reason and never silently resend.
5. Push assignment delivery is not part of the same outbox transaction yet.

### Field workflow/location

1. Location storage schema exists, but the Expo client does not yet request or capture GPS.
2. `expo-location` and `expo-task-manager` are not yet implemented for this flow.
3. The API currently forwards an object-shaped location payload; add explicit numeric/date/source validation before the command call.
4. Decide which field steps require GPS and what accuracy threshold is acceptable.
5. Do not background-track specialists by default.
6. Driver background tracking must exist only during an active trip and stop at arrival/completion, cancellation, unassignment or logout.
7. `mirrorFieldProgressToConversation` still updates conversation metadata after the authoritative command. The event/progress rows are the truth, but this compatibility projection can race. Replace it with a deterministic projection worker or database-side projection.

### Rekaz

1. `fetchRekazReservations()` currently excludes `Cancelled` rows. The new delta layer will see disappearance as `removed`, not a proven cancellation. Change the adapter so the sync input retains cancellation status, then filter cancelled rows only in the operational calendar display.
2. Confirm whether the Rekaz endpoint returns the complete configured window. Otherwise absence cannot safely mean removal.
3. The current integration uses an undocumented Rekaz web endpoint. Keep it behind the adapter and add health/failure reporting.
4. `GET /api/reservations/sync` performs a live Rekaz call on page mount. Add a short server cache or scheduled check to avoid excessive requests.
5. Add a bearer-authenticated mobile preview/pull endpoint; the existing web sync endpoint uses the web session.
6. Link `driver_orders` to a durable Rekaz reservation/visit ID. The old phone-plus-day matching is not sufficient.
7. The fixed test reservation `+201279119364` is still injected into the web read model. Gate it behind a development/test environment variable before production rollout.

### Mobile orders/calendar

1. `apps/mobile/app/(app)/(tabs)/orders/index.tsx` still renders the old local-order SectionList.
2. Replace it with a calendar-first selected-day agenda using `useOrdersCalendar`.
3. Show Rekaz services, provider, payment/status, customer, location and operational assignment in one visit card—not duplicate Rekaz and local cards.
4. Add a horizontal day strip with smooth selection transition and cached neighboring ranges.
5. Add same-day, planned, driver-needed and exception filters.
6. From an unlinked Rekaz visit, `طلب سائق` must create/link the local operational order and open the confirmation flow in place.
7. Customer name must navigate to a mobile customer profile.

### Customer profile and AI

The customer profile is **not blocked on canonical identity**, and an earlier
version of this document was wrong to imply it was. The web `/orders` drawer has
shipped it for a while: `getCustomerTimeline` in `src/lib/customer-timeline.ts`
keys on normalized phone — a conversation row *is* the customer — and stitches
Rekaz lifetime bookings and revenue onto this app's conversation, messages,
orders and notes.

Mobile now reads that same model at
`GET /api/mobile/v1/customers/[phone]/timeline`, rendered by
`apps/mobile/app/(app)/(tabs)/orders/customer/[phone].tsx`. Because the read
model is shared verbatim, the two surfaces cannot drift.

One deliberate difference: the mobile route is authorized more tightly than the
web one. The web dashboard lets any signed-in employee open any customer; the
mobile v1 contract keeps the inbox's exclusive routing, so a phone whose
conversation is routed to another employee returns 404 — matching the
"missing and forbidden look identical" rule the order endpoints already use.

Still not implemented on mobile:

- next-best-service retrieval/ranking
- real package image
- editable retarget message confirmation
- AI provenance/input hash/model/evidence persistence

Satisfaction analysis already exists per order
(`POST /api/mobile/v1/orders/[id]/analysis`) and is intentionally kept off the
profile screen: it costs a model call and stays behind an explicit action.

Do not build AI recommendation UI before catalog eligibility retrieval is
trustworthy. Canonical `customers` remains worth doing for reporting, but it is
not a prerequisite for the profile.

### Owner reports

Hanan is currently an active Kiara admin and can open the existing reports, but the reports are not yet accountability-grade.

Still required:

- event-based first response and P90
- six-minute SLA breaches
- follow-up coverage and late cancellation discovery
- order field corrections with creator/corrector
- transfer/takeover history
- duplicate/failed/uncertain dispatch
- driver and specialist timing
- location accuracy/distance/permission exceptions
- Rekaz and push health
- drilldown to the immutable event and actor at event time

Never attribute historical work to the conversation's current assignee.

### Offline, notifications and tests

- React Query is not yet persisted for safe offline reads/drafts.
- There is no complete offline mutation queue policy.
- Push must be tested on physical iOS and Android builds.
- Current Maestro coverage is minimal.
- Add stable `testID` values to all critical controls.
- Add database/API concurrency tests before UI polish is considered complete.

## 7. Recommended next execution order

### Step 1 — verify database truth first

1. Prepare or connect a staging Supabase project.
2. Upgrade/discover current CLI commands or use the Supabase MCP/SQL editor.
3. Apply migrations in timestamp order to staging only.
4. Run the verification queries included at the end of each migration.
5. Inspect function privileges and RLS.
6. Run database advisors.
7. Run concurrency/idempotency tests.
8. Fix migration SQL and re-run from a clean staging database.

Do not continue to production or remove legacy paths until this passes.

### Step 2 — finish the mobile calendar-first `/orders` screen

Start with:

- `apps/mobile/app/(app)/(tabs)/orders/index.tsx`
- `apps/mobile/lib/queries.ts`
- `apps/mobile/types/api.ts`
- `src/app/api/mobile/v1/orders/calendar/route.ts`

Build a selected-day agenda that merges Rekaz and local operational state into one visit card. Preserve Arabic RTL, 44/48pt touch targets, safe-area behavior, large text and screen-reader labels.

### Step 3 — mobile Rekaz check/pull

Create bearer-authenticated mobile endpoints for:

- check changes
- show added/updated/cancelled/removed preview
- pull under tenant lock
- return actual applied counts

Put the pending banner at the top of the mobile calendar and Today screen.

### Step 4 — location evidence

Add foreground checkpoint location first. Only then consider active-trip background driver tracking.

Use physical-device development builds. Expo Go is not the launch verification environment for remote push/background behavior.

### Step 5 — customer profile

Create canonical customer identity and the mobile customer route before AI retargeting.

### Step 6 — deterministic owner reports

Build metrics from `operation_events`, delivery events, sync runs and location checkpoints. Add drilldown evidence.

### Step 7 — AI

Add on-demand satisfaction and next-best-service only after the event/customer/catalog data is reliable.

### Step 8 — pilot and rollout

Pilot with Hanan, one customer-service employee, one driver and one specialist. Keep web as rollback until the real-device pilot passes.

## 8. Minimum database test matrix

Automate at least these cases:

1. Two employees update the same order version; one succeeds and one gets a conflict.
2. Same order update idempotency key replay returns the original result.
3. Same key reused for another command/aggregate is rejected.
4. Two dispatch commands race; only one reserves the order/outbox.
5. Repeated outbox claim; only one returns `claimed=true`.
6. Dispatch completion replay returns the original result.
7. Driver cannot execute a specialist step.
8. Specialist cannot execute a driver step.
9. Field step order cannot skip a transition.
10. Repeated field key does not duplicate the event/checkpoint.
11. Rekaz simultaneous pull; tenant advisory lock serializes applies.
12. Rekaz same snapshot creates only unchanged counts on the second distinct run.
13. Removed reservation creates one removal event and is not repeatedly removed.
14. Restored reservation creates a restored/update count.
15. `anon` and normal `authenticated` cannot read or mutate private workflow tables/functions.

## 9. Important files to inspect next

Architecture and handoff:

- `docs/mobile-crm-production-plan.md`
- `docs/mobile-crm-engineering-handoff.md`

Database:

- `supabase/migrations/20260811113000_field_staff_mobile_workflow.sql`
- `supabase/migrations/20260811142134_secure_mobile_inbox_realtime.sql`
- `supabase/migrations/20260811150941_operational_command_foundation.sql`
- `supabase/migrations/20260811152516_rekaz_delta_sync.sql`

Commands and dispatch:

- `src/lib/operational-commands.ts`
- `src/lib/dispatch.ts`
- `src/lib/field-staff.ts`
- `src/components/dispatch-dialog.tsx`
- `apps/mobile/app/(app)/(tabs)/orders/[id]/dispatch.tsx`

Rekaz/calendar:

- `src/lib/rekaz.ts`
- `src/lib/rekaz-sync.ts`
- `src/lib/reservations.ts`
- `src/app/api/reservations/sync/route.ts`
- `src/app/api/mobile/v1/orders/calendar/route.ts`
- `src/components/rekaz-reservations.tsx`
- `apps/mobile/app/(app)/(tabs)/orders/index.tsx`

## 10. Definition of the next safe checkpoint

The next AI should not report the feature as complete until:

- staging migrations apply cleanly from zero
- privilege/RLS verification passes
- concurrency tests pass
- the mobile calendar uses unified Rekaz/local data
- mobile check/pull is authenticated and visible
- no outbound dispatch can occur without exact editable confirmation
- root and mobile typecheck/lint still pass

At that checkpoint, report exactly what was applied to staging, what remains local-only and whether any production mutation occurred.

## 11. Suggested continuation prompt

Use this if a concise instruction is needed for the next AI:

> Read `AGENTS.md`, `docs/mobile-crm-production-plan.md`, and `docs/mobile-crm-engineering-handoff.md` completely. Preserve the dirty worktree. Begin by verifying the new Supabase migrations against staging and testing concurrency/idempotency; do not touch production. Then finish the mobile calendar-first `/orders` screen using the existing `useOrdersCalendar` contract and add authenticated mobile Rekaz preview/pull. Keep exact editable confirmation for every outbound message. Run root/mobile typecheck, lint and database security tests before reporting progress. Think critically and change the proposed implementation if evidence from staging shows a safer or simpler design.
