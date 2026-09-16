# Kiara Chat

Dedicated, white-labeled WhatsApp **customer-service inbox** for Kiara spa. A
standalone Next.js app that reuses the **shared whatsapp-cs Supabase project**
(same database as the parent platform) — Kiara-only, no multi-tenant UI.

## Architecture

- **Frontend:** Next.js 16 (App Router) — this folder. Deploys to its own Vercel
  project on a new domain.
- **Backend/DB:** the **existing** Supabase project `nkdkqgrkyqpjdaifazwn`. No new
  database, no data migration — Kiara's existing conversations/customers/messages
  are exposed in place, scoped to `restaurant_id = 2ba8f6c8-…`.
- **Isolation:** enforced **server-side** — RLS (the shared `is_restaurant_member`
  / `is_restaurant_admin` helpers, keyed off `team_members`) plus a **pinned
  Kiara tenant id** (`src/lib/tenant.ts`). The client never supplies a tenant id.
- **Transport:** WhatsApp via **two numbers with different jobs** — a Twilio
  sender on Meta's Business Platform (`+966508421748`) preserved for later reactivation,
  and a linked-device engine that temporarily handles inbox traffic plus staff outbound
  notifications for dispatch and field reminders. See the section below.

## Roles

- **Admin/Owner** — Kiara owner (`team_members.role='admin'` or `restaurants.owner_id`).
- **Agent** — the 10+ CS agents (`team_members.role='agent'`).

## Setup

```bash
bun install
cp .env.local.example .env.local   # already populated for dev; add SUPABASE_SERVICE_ROLE_KEY for admin tasks
bun run dev
```

Sign in with a Supabase-auth user that is Kiara's owner or an active
`team_members` row for the Kiara tenant.

## Phase status

- [x] **Phase 0** — grounding (mapped the shared codebase).
- [~] **Phase 1** — scaffold + Supabase wiring + auth guard + tenant-scoped read (this).
- [ ] Phase 2 — full auth/roles.
- [ ] Phase 3 — read-only shared inbox (list + thread + media).
- [ ] Phase 4 — WhatsApp pipeline + transport layer.
- [ ] Phase 5 — inbox interactions (reply, Take/Transfer/Release, statuses).
- [ ] Phase 6 — labels, notes, saved replies, search.
- [ ] Phase 7 — notifications (web + mobile push).
- [ ] Phase 8 — mobile app (Expo).
- [ ] Phase 9 — admin, white-label, deploy.

## Env

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Shared Supabase project (RLS client). |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin tasks only (create/suspend agents). Optional for read-only phases. |
| `KIARA_RESTAURANT_ID` | Pinned tenant (defaults to the Kiara id in code). |
| `OPENWA_URL` / `OPENWA_SEND_TOKEN` / `OPENWA_INGEST_TOKEN` | Persistent linked-device service for driver and specialist order notifications. See setup below. |
| `FIELD_SESSION_SECRET` | Signs field-staff links. Set it explicitly: it otherwise falls back to `OPENWA_SEND_TOKEN`, so a future retirement of that variable would silently invalidate every outstanding link. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio account. The auth token signs inbound webhooks and fetches inbound media — an API key cannot do either. |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Optional, preferred for sending: revocable without rotating the auth token. |
| `TWILIO_WHATSAPP_FROM` | The Business Platform sender, e.g. `whatsapp:+966508421748`. |
| `TWILIO_WEBHOOK_BASE_URL` | Public origin Twilio calls. Signature validation hashes this, not the request URL, which behind Vercel reports an internal host. |
| `TWILIO_STATUS_CALLBACK_URL` | Delivery-receipt endpoint (`/api/webhooks/twilio/status`). |
| `TWILIO_CONTENT_SID_BOOKING_FOLLOWUP` | Approved template sid (`HXbb5e5dbfc42600f2678e55b38445cdac`). Required for booking follow-up templates on the Business Platform. |
| `TWILIO_CONTENT_SID_CONVERSATION_OPENER` | The general opener — logo header, greeting by name (`HX21822b343fb1d89bed64aa0ef27fcd6c`). Marketing category, so Meta's per-customer marketing cap applies. |
| `WHATSAPP_INBOX_PROVIDER` | Customer inbox provider. Defaults to `twilio`; OpenWA order notifications are independent. |
| `WHATSAPP_CUSTOMER_PROVIDER` | Business Platform provider for campaigns and template management (`twilio` or `meta`). |

### Twilio inbox and OpenWA order notifications

The customer inbox defaults to Twilio. Keep
`WHATSAPP_INBOX_PROVIDER=twilio` in the deployment environment so incoming
messages, agent replies, media, voice notes, and the bot use the Twilio number.
`openwa` and `meta` remain explicit supported inbox settings for a future
cutover, but they are not required for field-team dispatch.

`WHATSAPP_CUSTOMER_PROVIDER` still selects the Business Platform provider for
campaigns and approved template management. Campaigns and staff dispatch keep
their existing routing. Approved templates are hidden and rejected in the
OpenWA inbox; send ordinary text instead, without a 24-hour service window.

The OpenWA engine must be running and paired to the field-team WhatsApp account.
`OPENWA_URL` and `OPENWA_SEND_TOKEN` control driver and specialist order
notifications, including dispatch, reminders, voice notes, and photos. No phone
number is hardcoded for OpenWA sends. Check the linked number and connection
state on the Connect page before rollout. Twilio keeps handling the inbox.

Inbound and phone-app replies populate the existing chat list, including group
chats. Message IDs deduplicate retries. History preserves its original time
and does not trigger unread increments, notifications, or bot replies. Typing
subscriptions work again for visible conversations. After rollback, the OpenWA
webhook acknowledges message/presence events without ingesting them; delivery
acks for previously sent messages still update history. Business Platform
webhooks continue to store incoming messages, but only trigger the bot when
the inbox uses that same provider.
