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
- **Transport:** WhatsApp via a **persistent OpenWA service** on the VPS (number
  `+966508421748`), behind a transport-abstraction layer (Twilio adapter later).
  The linked account is whatever `WA_CLIENT_ID` points at on the engine — /connect
  reports it live, so trust that over any number written down here.
  _Added in Phase 4._

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
- [ ] Phase 4 — persistent OpenWA pipeline + transport layer.
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
| `OPENWA_URL` / `OPENWA_SEND_TOKEN` / `OPENWA_INGEST_TOKEN` | OpenWA transport — the linked-device number `+966593695614`. |
| `FIELD_SESSION_SECRET` | Signs field-staff links. Set it explicitly: it otherwise falls back to `OPENWA_SEND_TOKEN`, so removing that variable would invalidate every outstanding link. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio account. The auth token signs inbound webhooks and fetches inbound media — an API key cannot do either. |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Optional, preferred for sending: revocable without rotating the auth token. |
| `TWILIO_WHATSAPP_FROM` | The Business Platform sender, e.g. `whatsapp:+966508421748`. |
| `TWILIO_WEBHOOK_BASE_URL` | Public origin Twilio calls. Signature validation hashes this, not the request URL, which behind Vercel reports an internal host. |
| `TWILIO_STATUS_CALLBACK_URL` | Delivery-receipt endpoint (`/api/webhooks/twilio/status`). |
| `TWILIO_CONTENT_SID_BOOKING_FOLLOWUP` | Approved template sid (`HXbb5e5dbfc42600f2678e55b38445cdac`). Without it, nobody outside the 24-hour window is reachable. |

### Two WhatsApp numbers, on purpose

Kiara answers on two numbers at once, and they are not interchangeable. The
original number is a linked device driven by the OpenWA engine on the VPS; the
newer one is a Twilio WhatsApp sender on Meta's Business Platform. A number can
only be one or the other, so both run side by side and each conversation is
answered on the number it arrived on — the provider is recorded in
`conversations.metadata.transport`, and threads that predate Twilio carry no
marker and resolve to OpenWA. Replying on the wrong number would reach the
customer as a message from a stranger, which is what `transportForConversation`
in `src/lib/transport/index.ts` exists to prevent.
