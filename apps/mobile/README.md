# Kiara Operations mobile app

Expo Router mobile client for Kiara customer-service operations. The current MVP includes:

- Supabase email/password for operations staff and phone/password for specialists/drivers, with sessions stored in `expo-secure-store`.
- Arabic RTL navigation and screens.
- Role/bootstrap gate for owner, admin, customer-service staff, specialists, and drivers.
- Inbox filters: `جديد`, `محادثاتي`, `غير مستلمة`, and `خطر`.
- Live typing indicators and animated reordering when assigned chats receive new messages.
- Employee-scoped push notifications: assigned or exclusively routed chats notify only that team member's registered devices.
- Conversation details, take-before-composer workflow, and text replies.
- A compact conversation-actions button opens one editable review sheet for
  communication status, booking stage, attendance confirmation, and labels.
- Orders list and detail with web-parity operational/audit data, reservation editing, assignment, and confirmed dispatch.
- On-demand AI customer analysis with satisfaction, communication quality, red flags, and recommendations.
- Authenticated specialist/driver orders with ride confirmation, pickup, service start, and order completion.
- Assignment push notifications and 30-minute reminders for the person who owns the pending step. Reminder scheduling and delivery run through Supabase Cron (`pg_cron`) and `pg_net`, not Vercel.
- Account details and sign-out.

Supabase is used for authentication and authorized Realtime Broadcast only. Business data still goes through the authenticated Kiara API; the app never subscribes directly to raw Postgres Changes. Private employee topics carry only conversation ids and trigger an API refetch, preserving the server's routing permissions. Polling and pull-to-refresh remain as a fallback.

## Setup

1. Copy `.env.example` to `.env`.
2. Set the Supabase project URL and **publishable** key. Never use a secret or service-role key.
3. Set `EXPO_PUBLIC_API_URL` to an address the phone can reach. For a physical device, use the computer's LAN address instead of `localhost`.
4. Set `EXPO_PUBLIC_EAS_PROJECT_ID` when it is not injected by an EAS development/production build.
5. Apply `supabase/migrations/20260811113000_field_staff_mobile_workflow.sql` and `supabase/migrations/20260811142134_secure_mobile_inbox_realtime.sql` to the shared project.
6. Install dependencies and start Expo:

```sh
npm install
npx expo start
```

The linked EAS project is `@mahm0udsaad/kiara-operations`. Production and
preview builds read their environment from EAS; `EXPO_PUBLIC_API_URL` must be a
public HTTPS deployment and must never point to `localhost` in a store build.

Use an EAS development build or production build to test remote push notifications on a physical device. The rest of the interface can still be developed with Expo Go.

## Required mobile API contract

Every endpoint is under `/api/mobile/v1` and receives `Authorization: Bearer <Supabase access token>`.

```text
GET  /bootstrap
GET  /conversations?view=new|mine|unassigned|specialists|danger
GET  /conversations/:id
POST /conversations/:id/take
POST /conversations/:id/reply      { "body": "..." }
POST /conversations/:id/reservation-follow-up { "dayKey", "status" }
PUT  /conversations/:id/actions   { "csStatus", "bookingStage", "labelIds", "reminderConfirmation" }
POST /conversations/:id/receipt   multipart { "file" } (image or PDF)
POST /presence
POST /push-token                  { "expoToken", "deviceId", "platform" }
DELETE /push-token                { "deviceId" }
GET  /orders
GET  /orders/:id
PATCH /orders/:id
GET  /dispatch-options
POST /orders/:id/dispatch   { "specialistId", "driverId", "specialistNote" }
GET  /field/orders
GET  /field/orders/:id
POST /field/orders/:id      { "action": "confirm_ride|confirm_pickup|start_service|complete_order" }
POST /field/push-token
DELETE /field/push-token
```

List responses use `{ "items": [] }`. Response DTOs are documented in `types/api.ts`.

Legacy signed specialist/driver links remain readable for old messages, but new
dispatches direct field staff to their authenticated app account.

## Checks

```sh
npm run typecheck
npm run lint
npx expo-doctor
```
