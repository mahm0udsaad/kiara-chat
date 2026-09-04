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
- **Transport:** WhatsApp via a **Twilio sender on Meta's Business Platform**
  (`+966508421748`), behind a transport-abstraction layer. The linked-device
  engine that carried `+966593695614` was retired on 2026-09-04 — see below.

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
| ~~`OPENWA_URL` / `OPENWA_INGEST_TOKEN`~~ | Retired 2026-09-04. Read by nothing; safe to delete. |
| `FIELD_SESSION_SECRET` | Signs field-staff links. Set it explicitly: it otherwise falls back to the retired `OPENWA_SEND_TOKEN`, so deleting that variable before this one is set invalidates every outstanding link. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio account. The auth token signs inbound webhooks and fetches inbound media — an API key cannot do either. |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Optional, preferred for sending: revocable without rotating the auth token. |
| `TWILIO_WHATSAPP_FROM` | The Business Platform sender, e.g. `whatsapp:+966508421748`. |
| `TWILIO_WEBHOOK_BASE_URL` | Public origin Twilio calls. Signature validation hashes this, not the request URL, which behind Vercel reports an internal host. |
| `TWILIO_STATUS_CALLBACK_URL` | Delivery-receipt endpoint (`/api/webhooks/twilio/status`). |
| `TWILIO_CONTENT_SID_BOOKING_FOLLOWUP` | Approved template sid (`HXbb5e5dbfc42600f2678e55b38445cdac`). Without it, nobody outside the 24-hour window is reachable. |
| `TWILIO_CONTENT_SID_CONVERSATION_OPENER` | The general opener — logo header, greeting by name (`HX21822b343fb1d89bed64aa0ef27fcd6c`). Marketing category, so Meta's per-customer marketing cap applies. |
| ~~`WHATSAPP_DEFAULT_PROVIDER`~~ | Retired 2026-09-04. One sender, nothing left to choose. |

### One WhatsApp number, since 2026-09-04

Kiara answered on two numbers for a while, deliberately: `+966593695614` as a
linked device driven by the OpenWA engine on the VPS, and `+966508421748` as a
Twilio sender on the Business Platform. A number can only be one or the other,
so they ran side by side and each conversation was answered on the number it
arrived on.

The linked device lost its session on 2026-09-03 and was never re-paired. Its
last message reached Kiara at 09:18 UTC that day; Twilio had already taken over
the same afternoon. Rather than re-pair it, the engine was stopped and removed
from pm2 on 2026-09-04 and the transport deleted from this codebase.

What that leaves behind, and why the code still mentions it:

- `TransportProvider` keeps its `"openwa"` member. 293 conversations carry no
  transport marker and most of the message history was captured through the
  engine; those rows still have to read back.
- `transportForConversation` no longer consults
  `conversations.metadata.transport`. The marker says which number a customer
  *used to* write to, and honouring it would route her reply into a dead pipe.
- Every one of those customers is outside the 24-hour window on a number she has
  never seen, so the first contact has to be a template —
  `kiara_conversation_opener` exists for exactly that, and a successful template
  send migrates her thread onto the Business number.
- Typing indicators and the staff WhatsApp nudges (dispatch notes, field
  reminders) were linked-device capabilities and are gone. Push carries the
  field team now.
- `/api/webhooks/openwa` answers 410 rather than 404: the engine's code and
  session directory are still on the VPS, and an engine started by hand would
  otherwise replay its backlog into a database that has moved on.
