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
  `+966594032490`), behind a transport-abstraction layer (Twilio adapter later).
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
| `OPENWA_URL` / `OPENWA_TOKEN` | Persistent OpenWA transport (Phase 4). |
