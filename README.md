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
  sender on Meta's Business Platform (`+966508421748`) for all customer chats,
  and a linked-device engine (`+966595532435`) that pushes staff-only outbound
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
| `OPENWA_URL` / `OPENWA_SEND_TOKEN` / `OPENWA_INGEST_TOKEN` | Persistent OpenWA service on the VPS — the salon's staff-outbound number `+966595532435`. Only reaches drivers and specialists; never touches customer conversations. |
| `FIELD_SESSION_SECRET` | Signs field-staff links. Set it explicitly: it otherwise falls back to `OPENWA_SEND_TOKEN`, so a future retirement of that variable would silently invalidate every outstanding link. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio account. The auth token signs inbound webhooks and fetches inbound media — an API key cannot do either. |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Optional, preferred for sending: revocable without rotating the auth token. |
| `TWILIO_WHATSAPP_FROM` | The Business Platform sender, e.g. `whatsapp:+966508421748`. |
| `TWILIO_WEBHOOK_BASE_URL` | Public origin Twilio calls. Signature validation hashes this, not the request URL, which behind Vercel reports an internal host. |
| `TWILIO_STATUS_CALLBACK_URL` | Delivery-receipt endpoint (`/api/webhooks/twilio/status`). |
| `TWILIO_CONTENT_SID_BOOKING_FOLLOWUP` | Approved template sid (`HXbb5e5dbfc42600f2678e55b38445cdac`). Without it, nobody outside the 24-hour window is reachable. |
| `TWILIO_CONTENT_SID_CONVERSATION_OPENER` | The general opener — logo header, greeting by name (`HX21822b343fb1d89bed64aa0ef27fcd6c`). Marketing category, so Meta's per-customer marketing cap applies. |
| `WHATSAPP_DEFAULT_PROVIDER` | Effectively fixed at `twilio` — customer conversations only ever go through the Business Platform now. Setting it to `openwa` breaks sends. |

### Two WhatsApp numbers, two jobs

Kiara answered on two numbers as a matter of course, then briefly on one, and
now on two again with a cleaner split. The abstraction that lives in
`src/lib/transport/index.ts` codifies which does what.

- **Twilio — `+966508421748`, on Meta's Business Platform.** Every customer
  conversation lives here: inbound, agent replies, and the approved templates
  that open a chat outside the 24-hour window. `transportForConversation()`
  always resolves here.
- **OpenWA — `+966595532435`, a linked device on the VPS engine.** Staff-only
  outbound. Dispatch notes to drivers and specialists, field reminders, the
  specialist voice note, the door photo. Called directly from `dispatch.ts`
  and `field-reminders.ts` — never through `transportForConversation`, because
  staff are not customer conversations.

What that split leaves behind, and why the code still reads the way it does:

- `TransportProvider` keeps its `"openwa"` member because history still has
  rows tagged that way, but nothing new gets that value on a customer
  conversation. `transportForConversation` no longer consults
  `conversations.metadata.transport` — honouring the stored marker would route
  a customer reply into a number that is now staff-outbound only.
- Any customer who wrote in on the old number `+966593695614` (retired
  2026-09-03) is now outside the 24-hour window on a Twilio number she has
  never seen, so first contact must be an approved template. That is what
  `kiara_conversation_opener` exists for, and a successful template send
  migrates her thread onto the Business number.
- `/api/webhooks/openwa` answers **410**, not 404. Customer ingest is a
  Twilio-only responsibility now, and a hand-started engine forwarding its
  fromMe backlog into that endpoint would double-write history. The 410 is a
  loud, named refusal rather than a silent 404 that reads like a bad deploy.
- Typing indicators are gone — WhatsApp presence is a linked-device capability
  and the Business Platform exposes none for customer chats. The presence
  routes stay as no-ops so shipped mobile builds keep parsing them.
- The linked device does **not** receive customer messages. If a customer ever
  writes to `+966595532435` directly, her message is dropped by the 410. That
  number is not published to customers.
