# Kiara Operations mobile app

Expo Router mobile client for Kiara customer-service operations. The current MVP includes:

- Supabase email/password authentication with session tokens stored in `expo-secure-store`.
- Arabic RTL navigation and screens.
- Role/bootstrap gate for owner, admin, and customer-service staff.
- Inbox filters: `جديد`, `غير مستلمة`, and `خطر`.
- Conversation details, take-before-composer workflow, and text replies.
- Orders list and detail, reservation editing, assignment, and confirmed dispatch.
- Public signed field-session links for specialists and drivers, including location, start, and completion.
- Account details and sign-out.

Supabase is used by the app for authentication only. Business data goes through the authenticated Kiara API. The app intentionally does not subscribe directly to Supabase Postgres Changes; polling and pull-to-refresh preserve the server's routing permissions until row-level Realtime authorization is available.

## Setup

1. Copy `.env.example` to `.env`.
2. Set the Supabase project URL and **publishable** key. Never use a secret or service-role key.
3. Set `EXPO_PUBLIC_API_URL` to an address the phone can reach. For a physical device, use the computer's LAN address instead of `localhost`.
4. Install dependencies and start Expo:

```sh
npm install
npx expo start
```

This MVP uses only Expo Go-compatible packages.

## Required mobile API contract

Every endpoint is under `/api/mobile/v1` and receives `Authorization: Bearer <Supabase access token>`.

```text
GET  /bootstrap
GET  /conversations?view=new|unassigned|danger
GET  /conversations/:id
POST /conversations/:id/take
POST /conversations/:id/reply      { "body": "..." }
GET  /orders
GET  /orders/:id
PATCH /orders/:id
GET  /dispatch-options
POST /orders/:id/dispatch   { "specialistId", "driverId", "specialistNote" }
```

List responses use `{ "items": [] }`. Response DTOs are documented in `types/api.ts`.

Signed specialist/driver links open at `kiara://session/<token>` and use the public
`GET/POST /api/session/:token` endpoint. The token is the authorization for only
that field-session dashboard; these screens do not require or expose a staff login.

## Checks

```sh
npm run typecheck
npm run lint
npx expo-doctor
```
