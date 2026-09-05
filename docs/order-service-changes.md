# Service changes during a visit

The web order-details sheet and mobile order-details screen now include **خدمات الزيارة**. Staff can add or edit a manual service, review nearby Rekaz additions/changes, dismiss a suggestion, or link a later Rekaz booking to an existing manual service without adding time twice. A preview shows the estimated finish and both editable notification bodies. Approval is required; detection never authorizes work on its own.

Services run sequentially with the visit's assigned specialist. Actual service start anchors the estimate when available. Gaps and later starts increase the expected finish. Existing service changes apply the duration difference; moving a service later carries the delay forward. A subsequent assignment inside the extension blocks approval. Completed visits require a new visit; parallel specialists and reopening completed visits are not part of this release. Financial records are unchanged, and manual additions do not write to Rekaz.

## Data and delivery

`order_visit_services` stores the approved snapshot, separate from incoming Rekaz data. Creation captures existing same-basket services; legacy baseline capture uses the anchor and services seen before the order was created. Staff should review ambiguous legacy suggestions carefully. Matching uses normalized phone, the Riyadh day and a nearby time window (30 minutes before arrival through 60 minutes after estimated finish), shows provider/address information for human verification, and excludes reservations already linked elsewhere. It is a suggestion, not proof that the booking belongs to the visit.

Confirmation uses a server-owned ten-minute preview, checks order version, field progress and Rekaz hash, and commits the service, duration, audit event, order notes and two notification jobs in one database transaction. Retrying the same approval does not repeat the service or jobs. Later manual/Rekaz reconciliation requires matching durations.

Push notifications use the exact approved bodies, with specialist translation performed before preview. Both bodies are also stored in order notes, so the field app retains the content. Jobs retry up to five times, with a two-minute recovery lease for interrupted workers. Delivery is at-least-once: a crash after external acceptance may repeat a push. “Accepted” means Expo accepted the push, not that the person read it. Missing devices and failures remain visible in order details. No WhatsApp or customer message is sent by this feature.

## Rollout

1. Apply `supabase/migrations/20260905095340_order_service_changes.sql` before deploying the app changes. No hosted migration or deployment was performed during implementation.
2. Deploy the web/API and rebuild the mobile app. The migration registers `kiara-service-changes` every two minutes, using the existing Vault `cron_secret` and app `CRON_SECRET`. Verify the hostname in the migration for this installation.
3. Verify the cron can POST `/api/cron/service-changes`, that Rekaz session credentials remain valid, and that its request volume is acceptable. It uses the current full reservation fetch window, not a new upstream webhook. Background sync also refreshes the legacy web snapshot. Failed Rekaz sync does not prevent notification retries.
4. On staging, approve an addition for a test visit and verify both registered field devices, order notes, expected finish and schedule conflict behavior. Real push delivery and native-device UI still require staging verification.

## Verification

- `node --experimental-strip-types --test tests/service-change-planning.test.mjs`
- `bash supabase/tests/run-db-tests.sh` (isolated PostgreSQL; cron/net are stubs).
- Root and mobile TypeScript checks; ESLint on changed modules.

The browser smoke check was blocked by local disk exhaustion while starting Next.js; its temporary page and generated development cache were removed. Existing unrelated mobile type errors are recorded in the implementation handoff.
