# Kiara Operations mobile — agent work order

**Written:** 2026-08-22 · **For:** an AI agent picking this up cold
**Repo:** `/Users/mahmoudmac/Documents/projects/kiara-chat` · branch `main`

This document is self-contained. You do not need the other docs to start.
`docs/mobile-crm-production-plan.md` (strategy) and
`docs/mobile-crm-engineering-handoff.md` (earlier engineering state) are
background only, and parts of them predate this audit.

Every claim below carries a file path. **Verify before you act** — this audit is
a static read plus a failed build attempt, not a run of the app. Anything marked
`ASSUMED` has not been confirmed against a running system or the database.

---

## 1. What this is

A white-labeled WhatsApp customer-service inbox for Kiara spa (Arabic, RTL).

- `apps/mobile` — **Expo SDK 57 / RN 0.86 / expo-router 57** app. iPhone only
  (`supportsTablet: false`). This is the surface you are working on.
- `src/**` — Next.js 16 app. Serves the web inbox *and* the mobile API under
  `src/app/api/mobile/v1/**`. Deployed at `https://kiara-chat-eight.vercel.app`.
- Database — the **shared** whatsapp-cs Supabase project `nkdkqgrkyqpjdaifazwn`,
  pinned to one tenant (`src/lib/tenant.ts`, `KIARA_RESTAURANT_ID`). There is no
  staging project. Treat all data as production.
- WhatsApp transport — a persistent engine on a VPS; inbound arrives at
  `src/app/api/webhooks/twilio/route.ts`. `/api/webhooks/openwa` still answers 410 — the OpenWA linked device is staff-outbound only and does not ingest customer messages.

**Who uses it:** ~10 customer-service employees (`team_members.role='agent'`)
plus the owner Hanan (`hanan@kiara.com`, admin). One login per person.

**Roles** resolve in `src/lib/tenant.ts::getKiaraSession`. Mobile also supports
field staff (specialist/driver) on a separate route tree (`apps/mobile/app/field/**`)
— out of scope unless stated.

---

## 2. Before you write any code: you probably cannot build this

**The iOS app does not compile on Xcode 26.1.1 / Swift 6.2.1.** Confirmed
2026-08-22. `expo-modules-jsi@57.0.4` fails three independent ways:

1. `weak let` — "must be a mutable variable" (~15 sites)
2. `weak var` in a `Sendable` class — "stored property is mutable" (6 sites)
3. `abs(milliseconds) <= maxJavaScriptDateMilliseconds` in
   `Coding/JavaScriptCodable+Date.swift:53` — "type of expression is ambiguous"

The build dies at the `[CP-User] Build ExpoModulesJSI xcframework` phase.
Independently reproducible: `swiftc -typecheck` on a two-line file containing
`weak let` is rejected by this toolchain.

**Do not patch `node_modules` to get around this.** It was tried; fixing (1)
exposes (2), fixing (2) exposes (3). Each patch drifts further from what EAS
actually compiles.

**Fix:** upgrade to **Xcode 26.2+**. Then pin it so local and CI agree:

```json
// eas.json → build.production
{ "image": "macos-sequoia-15.x-xcode-26.2" }
```

Also required on macOS or `pod install` dies with an encoding error:

```bash
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
```

Both belong in `apps/mobile/README.md`. Note that **EAS Build picks its own
Xcode image**, so production builds may be succeeding while no developer can
build locally — that drift is itself a release risk.

### Running it once you can build

```bash
cd apps/mobile
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
npx expo run:ios --device "iPhone 17"
```

`apps/mobile/.env` points `EXPO_PUBLIC_API_URL` at **production**. There is no
staging. If you exercise send/take/dispatch you are touching real customer
conversations — get explicit permission first.

`npx tsc --noEmit` in `apps/mobile` passes clean as of this writing. Keep it that way.

---

## 3. Ground rules — non-negotiable

1. **True confirmation** (`AGENTS.md`, repo root). Anything that sends
   customer-facing content must show the exact final text **and let the user
   edit it** before sending. A read-only preview or a checkbox is not enough.
   Automatic additions (signed links, signatures) must be shown as such.
2. **Design tokens only.** `apps/mobile/constants/theme.ts` is the single source
   for colour, spacing, radius, type, and elevation. Never hardcode a hex,
   shadow, or spacing number in a screen.
3. **Arabic, RTL, feminine address.** All user-facing copy is Arabic and the
   existing strings address the employee as female ("سجّلي", "افتحي"). Match it.
   Phone numbers need `writingDirection: "ltr"` inside RTL text or the leading
   `+` reorders.
4. **Tenant isolation is server-side.** The client never supplies a tenant id.
   Do not add one.
5. **Do not weaken the reply guard.** An admin replying into another employee's
   thread must still take it over with a reason
   (`src/lib/conversation-reply-access.ts`).

---

## 4. The work, in priority order

### P0-1 · Message history is capped at 8 messages

**The single worst defect.** An agent cannot read a customer's history.

- `src/lib/inbox.ts:68` — `MESSAGE_PAGE_SIZE = 8`
- `src/app/api/mobile/v1/conversations/[id]/route.ts` returns that first page
  plus `hasMore` and `nextBefore` — correct.
- `src/app/api/mobile/v1/conversations/[id]/messages/route.ts` is a working
  cursor-paged endpoint (`?limit=&before=`) that **the mobile app never calls**.
- `apps/mobile/app/(app)/(tabs)/inbox/[id].tsx` — the `FlatList` is `inverted`
  and has no `onEndReached`. `apps/mobile/lib/queries.ts` has no hook for it.

**Do:** add `useConversationMessages` (React Query `useInfiniteQuery`, cursor =
`nextBefore`) and wire `onEndReached` on the inverted list. Because the list is
inverted, `onEndReached` fires when scrolling **up** into older messages — that
is what you want. Server dedupes by `id`; the `before` bound is inclusive
(`src/lib/inbox.ts`), so drop duplicates by id client-side.

**Accept when:** a thread with 200+ messages scrolls back through all of them,
no duplicate bubbles, no jump in scroll position when a page lands, day
separators still correct across page boundaries.

---

### P0-2 · The owner may receive zero notifications

`src/lib/tenant.ts::getKiaraSession` — a user who is `restaurants.owner_id` but
has **no `team_members` row** gets `role: "admin"` with `teamMemberId: null`.

That null silently disables, all at once:

- push registration — `apps/mobile/providers/notification-provider.tsx` only
  registers when `inboxStaff && teamMemberId`
- realtime refresh — `apps/mobile/providers/inbox-live-provider.tsx` needs
  `teamMemberId` for its private channel
- the "محادثاتي" filter — `src/lib/mobile/conversations.ts::matchesView`
- taking a conversation — `.../take/route.ts` returns 403 `TEAM_MEMBER_REQUIRED`
- `capabilities.canTakeConversations` in `/bootstrap`

The app still looks signed in and functional. `ASSUMED`: I could not query the
database to check whether Hanan has a `team_members` row.

**Do, in this order:**
1. **Check the data first.** If `hanan@kiara.com` lacks an active
   `team_members` row with `role='admin'` for the Kiara tenant, add it. That
   alone may resolve this.
2. **Then fix the code so it cannot fail silently**, because the data can drift
   again. Either resolve a `teamMemberId` for owners, or surface an explicit
   blocking state — the account screen must never show a healthy-looking session
   that cannot receive push.

**Accept when:** signing in as Hanan shows role `الإدارة` **and** the capability
`استلام المحادثات`, the account screen reads "الإشعارات مفعّلة على هذا الجهاز.",
and a test message produces a push on her device.

---

### P0-3 · Android push cannot work

`apps/mobile/app.json` has no `android.googleServicesFile` and there is no
`google-services.json` in the repo. FCM credentials are required.

**Do:** either add the FCM config and verify delivery on a real Android device,
or get an explicit written decision that the rollout is **iOS-only** and remove
Android from `eas.json` build profiles so nobody ships an untested binary.

---

### P1-1 · Decide the client-ownership model, then build to it

**Read this carefully — the product requirement and the implementation disagree.**

The stated requirement is *"each employee has her own clients."* What exists:

- **`assigned_to`** (set by استلام / take) controls **who may reply**. It does
  **not** hide the conversation. Every agent still sees every chat in every
  filter. See `src/lib/mobile/conversations.ts::matchesView`.
- **`metadata.routed_to`** is the real exclusive route — a routed chat is
  invisible to everyone else (`src/lib/conversation-meta.ts::canViewConversation`,
  applied in `src/lib/inbox.ts::listConversations` and guarded per-route by
  `src/lib/conversation-access.ts::denyIfRouted`).
- `routed_to` is written **only** from the web inbox
  (`src/components/inbox/inbox-client.tsx`). **There is no mobile UI for it.**

So today mobile gives you a shared queue with exclusive reply, not private
client books.

**Do not guess which model is wanted.** Get the decision, then:
- **Shared queue (current):** no code change; make the UI say so plainly.
- **Private client books:** decide whether CS staff route from mobile. If yes,
  build the routing UI and reuse `denyIfRouted` — do not invent a second rule.

**Accept when:** the chosen model is written down, and for private books,
Agent B gets a 403 from a direct API call to Agent A's routed conversation
(test with curl, not just the UI).

---

### P1-2 · Cold-start push tap does not open the conversation

`apps/mobile/providers/notification-provider.tsx` wires only
`addNotificationResponseReceivedListener`. When the app is **killed**, the tap
that launched it has already been delivered before that listener mounts.

**Do:** also read `Notifications.getLastNotificationResponseAsync()` (or
`useLastNotificationResponse()`) on mount and route from it. Guard against
double-navigation when both paths fire, and against routing before auth and
`/bootstrap` have resolved — the URL is `/inbox/<id>` and a field-staff or
signed-out user must not land there.

**Accept when:** force-quit the app, tap a push, and it opens that conversation.

---

### P1-3 · No error boundary, no crash reporting

Nothing in `apps/mobile` catches render errors and no Sentry/Bugsnag is
installed. A single bad render is a white screen that nobody hears about.

**Do:** add an error boundary at the root (expo-router supports an
`ErrorBoundary` export from a layout) with an Arabic recovery state, plus crash
reporting. Scrub customer phone numbers and message bodies from anything you
send off-device.

---

### P1-4 · Signed-out phones keep receiving customer alerts

`apps/mobile/lib/api.ts::unwrap` — on 401 it calls
`supabase.auth.signOut({ scope: "local" })` but never unregisters the push
token. `unregisterInboxNotifications()` is only called from the Account screen's
explicit logout. So a session that expires leaves the device registered and it
keeps waking up with real customer names until someone signs in again.

Partial mitigation exists: `registerInboxPushToken`
(`src/lib/inbox-notifications.ts`) deletes a token row held by a *different*
team member on next login. That does not help in the gap.

**Do:** unregister on any sign-out path, including expiry. Best-effort and
non-blocking — a failed unregister must not trap the user on a broken screen.

---

### P1-5 · Late-conversation ("خطر") alerts may never fire

`src/app/api/cron/inbox-danger/route.ts` implements the sweep and needs an
external caller with `CRON_SECRET`. **There is no `vercel.json`**, so this is not
a Vercel Cron. Project convention is `pg_cron` + `pg_net`.

**Do:** verify the scheduled job actually exists in production and fires about
once a minute. If not, create it. `ASSUMED`: not verified.

**Accept when:** an unanswered inbound crosses 6 minutes and the team gets
exactly one "⚠️ محادثة متأخرة", and repeated sweeps over the same unanswered
message stay silent.

---

### P2-1 · Sends feel slow (no optimistic update)

`apps/mobile/components/inbox/composer.tsx:310` —
`reply.mutate(text, { onSuccess: () => setDraft("") })`. The draft clears and
the bubble appears only after a round trip that includes the WhatsApp hand-off,
then a refetch invalidation.

**Do:** optimistic bubble with a pending state, reconcile on success, restore the
draft and show the error on failure. Do not clear the draft before the send is
known to have succeeded.

---

### P2-2 · Inbox list is O(500 rows) per poll

`src/lib/mobile/conversations.ts` — `MAX_MOBILE_CONVERSATION_SCAN = 500`.
Every request fetches up to 500 conversations **plus** the roster phone list,
then filters and counts all four views in JS. `apps/mobile/lib/queries.ts` polls
this every 30s per agent, and `app/(app)/(tabs)/_layout.tsx` holds a second
query for the tab badge.

With 10 agents that is the main latency and cost risk. The JS-side filter exists
because `routed_to` lives inside a JSON column.

**Do:** measure first (p50/p95 for `GET /conversations` at 10 concurrent
agents). If p95 > 800ms, move view filtering and counts into SQL — a
generated column or expression index on `metadata->>'routed_to'` makes the
visibility rule indexable. Keep `canViewConversation` as the single source of
truth; do not fork the rule into SQL and leave the JS copy behind.

---

### P2-3 · UI defects (found by reading; **not yet seen running**)

- **Dark-mode shadows.** `constants/theme.ts:175` exports a theme-aware
  `elevation()` with proper black shadows for dark. Only
  `components/ui/card.tsx:15` consumes it. Hardcoded **light-mode** navy
  shadows sit in `app/(app)/(tabs)/inbox/index.tsx:65`,
  `app/(app)/(tabs)/orders/index.tsx:328`, and
  `components/ui/segmented.tsx:66`. In dark mode these read as a navy tint,
  not a shadow. Route them through `shadow` from `useTheme()`.
- **Theme flash on cold start.** `providers/theme-provider.tsx` initialises to
  `"system"` and loads the saved preference from SecureStore in an effect. An
  employee who chose Light on a dark-mode phone sees dark for a frame or two
  every launch. Gate first paint until the preference resolves (the splash
  screen is already there for this).
- **Mixed digit systems in the unread pill.** `components/ui/badge.tsx`
  `CountBadge` renders `count` raw (Latin) but caps at `"٩٩+"`
  (Arabic-Indic), in a `tabular-nums` pill. Reads `98`, `99`, `٩٩+`. Pick one
  numeral system for the whole app and apply it consistently.
- **RTL on first launch.** `app/_layout.tsx:8-9` calls `I18nManager.allowRTL`/
  `forceRTL` at module scope. On a fresh install the first launch can paint LTR
  until restarted. Verify on a clean simulator install; if reproducible, handle
  the documented restart-once dance.

---

## 5. Decisions you must not make alone

Escalate these; do not pick a default:

1. **Ownership model** (P1-1) — shared queue vs private client books.
2. **Android** (P0-3) — ship FCM, or iOS-only?
3. **Xcode upgrade** (§2) — needed before anyone can build or verify anything.
4. **Production data** — there is no staging. Any write test touches real
   customers.

---

## 6. Verification

The full executable QA checklist is `docs/mobile-production-test-checklist.md`
(14 sections: accounts, auth, ownership, notifications, inbox, sending, orders,
performance, resilience, RTL/a11y, security, release, go/no-go).

**Its UI, performance, and notification sections have never been executed** —
the build blocker (§2) prevented it. Do not treat any of it as passing.

Minimum before touching the whole team, from that document's gate:

1. P0-1 fixed — full history reachable
2. P0-2 verified — Hanan gets push
3. P0-3 resolved — Android works or is explicitly out
4. P1-1 decided and tested
5. P1-5 verified — the sweep is really scheduled
6. P1-3 shipped — error boundary + crash reporting
7. Notification matrix passes on real hardware (push never works on a simulator —
   `lib/notifications.ts` returns `{ state: "simulator" }` by design)
8. Load test passes at real agent count

Rollout: 2 employees for 3 days → 5 for a week → all.

---

## 7. What was NOT verified

Be honest about this inheritance:

- **No screen has been seen running.** Every UI claim here is from source.
- **No database query succeeded** — the owner's `team_members` row, active agent
  rows, and the `pg_cron` job are all `ASSUMED`.
- **No push was ever delivered or observed.** The notification rules in §4 are
  read from `src/lib/inbox-notifications.ts`, not witnessed.
- **No performance number was measured.** The polling concern is arithmetic
  from the code, not a profile.
- `npx tsc --noEmit` passing in `apps/mobile` is the only thing actually
  executed green.
