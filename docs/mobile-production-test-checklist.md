# Kiara Operations (mobile) — production readiness test checklist

Audit date: 2026-08-22  
Surface under test: `apps/mobile` (Expo SDK 57 / RN 0.86 / expo-router 57)  
Backend under test: `src/app/api/mobile/v1/**` on `https://kiara-chat-eight.vercel.app`  
Audience: Kiara CS team (one login per employee) + owner `hanan@kiara.com`

This is a **test checklist**, not a plan. It complements
`docs/mobile-crm-production-plan.md` (strategy) and
`docs/mobile-crm-engineering-handoff.md` (engineering state).

---

## 0. Blockers found by reading the code — verify/fix before the pilot

These are not hypotheses; each one is a specific behaviour in the current code.
Anything marked **BLOCKER** will be hit on day one of a real rollout.

| # | Severity | Finding | Evidence |
|---|---|---|---|
| B1 | **BLOCKER** | A thread shows only the **last 8 messages** and there is no way to load older ones. The `/messages` paging endpoint exists and works, but the mobile thread never calls it and the `FlatList` has no `onEndReached`. A CS agent cannot read the customer's history. | `src/lib/inbox.ts:68` (`MESSAGE_PAGE_SIZE = 8`), `apps/mobile/app/(app)/(tabs)/inbox/[id].tsx` (no paging), `src/app/api/mobile/v1/conversations/[id]/messages/route.ts` (unused) |
| B2 | **BLOCKER** | If `hanan@kiara.com` is only `restaurants.owner_id` and has **no `team_members` row**, `teamMemberId` is `null`. That silently disables: push registration, realtime refresh, "محادثاتي" filter, and taking any conversation (403 `TEAM_MEMBER_REQUIRED`). The owner would appear signed-in and functional but receive **zero notifications**. | `src/lib/tenant.ts` (owner branch returns `teamMemberId: null`), `apps/mobile/providers/notification-provider.tsx` (`inboxStaff && teamMemberId`), `apps/mobile/providers/inbox-live-provider.tsx` |
| B3 | **BLOCKER (Android only)** | No `google-services.json` and no `android.googleServicesFile` in `app.json`. Android push cannot be delivered. iOS is prebuilt (`ios/` exists) and configured. | `apps/mobile/app.json` |
| B4 | High | Tapping a push when the app is **killed** does not open the conversation. Only `addNotificationResponseReceivedListener` is wired; `getLastNotificationResponseAsync` / `useLastNotificationResponse` is not. | `apps/mobile/providers/notification-provider.tsx` |
| B5 | High | **"Each employee has her own clients" is not what استلام (take) does.** `assigned_to` only controls who may *reply*; every agent still **sees** every conversation in the list. True per-employee isolation is `metadata.routed_to`, and it can only be set from the **web** inbox — there is no mobile UI for it. | `src/lib/conversation-meta.ts` (`canViewConversation`), `src/lib/inbox.ts` (`listConversations`), `src/components/inbox/inbox-client.tsx` (only place `routed_to` is written) |
| B6 | High | No error boundary and no crash reporting (no Sentry/Bugsnag). One render error = white screen, and nobody finds out. | `apps/mobile/**` (none present) |
| B7 | Medium | Session expiry signs out locally but **does not unregister the push token**. A phone that has been signed out by token expiry keeps receiving customer alerts until someone signs in again. | `apps/mobile/lib/api.ts` (`unwrap` → `signOut({scope:"local"})`), `apps/mobile/lib/notifications.ts` |
| B8 | Medium | No optimistic send. The draft clears and the bubble appears only after the round trip that includes the WhatsApp hand-off, then a refetch. Every send feels slow. | `apps/mobile/components/inbox/composer.tsx:310`, `apps/mobile/lib/queries.ts` (`useReply`) |
| B9 | Medium | The "خطر" (late conversation) alert requires an external scheduler to call `/api/cron/inbox-danger`. There is **no `vercel.json`**, so this must exist as a `pg_cron` job. If it does not, late-conversation alerts never fire. | `src/app/api/cron/inbox-danger/route.ts`, no `vercel.json` |
| B10 | Medium | No "forgot password" in the mobile login. With 10+ employees the owner must reset every password from the Supabase dashboard. | `apps/mobile/app/(auth)/login.tsx` |
| B11 | Medium | The inbox list is served by fetching **up to 500 conversation rows plus the roster** and filtering in JS, on **every** poll (every 30s per agent, per view) — plus the tab-badge query. With 10 agents this is the main latency and cost risk. | `src/lib/mobile/conversations.ts` (`MAX_MOBILE_CONVERSATION_SCAN = 500`), `apps/mobile/lib/queries.ts` (`refetchInterval`) |
| B12 | Low | `I18nManager.forceRTL(true)` runs at module scope. On a fresh install the very first launch can render LTR until the app is restarted. | `apps/mobile/app/_layout.tsx:9` |
| B13 | **BLOCKER (build)** | The iOS app **cannot be compiled on Xcode 26.1.1 / Swift 6.2.1**. `expo-modules-jsi@57.0.4` uses `weak let`, `weak var` in `Sendable` classes, and a `Double` comparison that only type-checks on a newer Swift — three independent failures. Verified on 2026-08-22: the build fails at the `[CP-User] Build ExpoModulesJSI xcframework` phase. Requires Xcode 26.2+. EAS Build picks its own Xcode image and may succeed where local machines fail, which hides the drift. | `node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/**`, `apps/mobile/.expo/xcodebuild.log` |
| B14 | Medium | `pod install` fails on macOS unless `LANG=en_US.UTF-8` is exported (CocoaPods `Encoding::CompatibilityError`). Not documented in the README, so a new machine hits it immediately. | `apps/mobile/README.md` (setup steps) |

**Verified green:** `npx tsc --noEmit` passes clean in `apps/mobile`.

**Not yet verified visually:** no screen in this app has been reviewed on a running device — B13 blocked it. Every UI/UX item below is still unchecked for that reason.

---

## 1. Environment & build

- [ ] `EXPO_PUBLIC_API_URL` in the production build points at the production Vercel URL (not a LAN IP). Confirm in the EAS `production` environment, not just `.env`.
- [ ] `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set in the EAS `production` environment.
- [ ] Server env on Vercel: `SUPABASE_SERVICE_ROLE_KEY`, `KIARA_RESTAURANT_ID`, `OPENWA_URL`, `OPENWA_SEND_TOKEN`, `OPENWA_INGEST_TOKEN`, `CRON_SECRET` — all present and non-empty.
- [ ] `apps/mobile/.env` (dev) is **not** what the store build reads. Confirm with `eas build --profile production` output.
- [ ] `npx tsc --noEmit` and `npm run lint` both clean.
- [ ] **B13** — a clean `npx expo run:ios` succeeds on the team's actual Xcode version. Record that version in the README.
- [ ] **B14** — `LANG=en_US.UTF-8` documented as a setup prerequisite.
- [ ] The Xcode version used by EAS Build matches what developers run locally (pin `image` in `eas.json`), so CI cannot pass while local fails.
- [ ] Production build installs and launches on a **real device** (Expo Go and the simulator both hide push and native-module problems).
- [ ] `app.json` version/buildNumber bumped; `eas.json` `autoIncrement` confirmed for production.
- [ ] Stale `apps/mobile/dist/` web export is not shipped or mistaken for the app build.

## 2. Accounts & roles (do this first — B2)

- [ ] `hanan@kiara.com` has an **active `team_members` row** for `restaurant_id = 2ba8f6c8-…` with `role = 'admin'`, *in addition to* being `restaurants.owner_id`.
- [ ] Sign in as Hanan → Account screen shows role **الإدارة** and the capability chips **استلام المحادثات**, **إدارة الفريق**, **عرض أسعار الطلبات**. If **استلام المحادثات** is missing, B2 is live — stop and fix the row.
- [ ] Each employee has her own Supabase auth user and her own **active** `team_members` row with `role = 'agent'`.
- [ ] No shared logins. Confirm one `team_members.user_id` per person.
- [ ] A suspended employee (`is_active = false`) is refused at `/bootstrap` and cannot open the inbox.
- [ ] A user with no membership at all sees the "الواجهة غير متاحة لهذا الدور" screen with a working sign-out, not a crash.

## 3. Auth & session

- [ ] Email + password login works; phone-number login works (the screen accepts both).
- [ ] Wrong password shows the Arabic error and haptic, and does not lock the UI.
- [ ] Airplane mode at login → "تعذر الاتصال بالخادم" and not a hang.
- [ ] Session survives: force-quit and relaunch stays signed in (SecureStore).
- [ ] Session survives a 24h+ gap (token auto-refresh on foreground).
- [ ] Expired/revoked session → the app returns to the login screen instead of showing empty lists.
- [ ] Sign-out clears the React Query cache: sign out, sign in as a **different** employee, and confirm no conversation from the previous account is visible for even a frame.
- [ ] After sign-out, that phone stops receiving push for the previous employee (**B7** — expect a failure if the sign-out was caused by token expiry rather than the button).

## 4. Per-employee client ownership — the core requirement (B5)

Decide first **which model Kiara actually wants**, because they behave differently:

- **Model A — shared queue, exclusive reply (what is implemented today).** Everyone sees every chat; استلام makes it *yours to answer*; others see "مستلمة من موظف آخر" and cannot reply.
- **Model B — private client books ("each employee has her own clients").** Requires `metadata.routed_to`, settable **only from the web inbox**. There is no mobile UI for it.

- [ ] Product decision recorded: Model A or Model B.
- [ ] **Model A tests:**
  - [ ] Agent A opens an unassigned chat → sees **استلام المحادثة** → taps it → composer appears.
  - [ ] Agent B opens the same chat → sees "هذه المحادثة مستلمة من موظف آخر" and **no composer**.
  - [ ] Two agents tap استلام within the same second → exactly one wins; the loser sees a clear 409 message, not a silent failure.
  - [ ] Hanan (admin) opens A's chat → is offered **takeover with a required reason** (min 3 chars) and cannot reply without it.
  - [ ] The takeover reason is persisted and visible in the owner/accountability report.
  - [ ] The "محادثاتي" filter shows exactly the chats assigned to the signed-in agent, and nothing else.
- [ ] **Model B tests (if chosen):**
  - [ ] Owner routes a chat to Agent A from the **web** inbox.
  - [ ] Agent A sees it on mobile; Agent B does **not** see it in any filter (جديد / غير مستلمة / خطر) and gets no unread badge for it.
  - [ ] Agent B deep-linking to that conversation id gets **403** "هذه المحادثة موجّهة إلى موظف آخر".
  - [ ] Hanan sees all routed chats regardless of route.
  - [ ] Decide and record: does the CS team need to route from mobile? If yes, that UI does not exist yet.

## 5. Notifications (test on real hardware only)

Registration
- [ ] First launch after login prompts for notification permission; Account screen then reads **"الإشعارات مفعّلة على هذا الجهاز."**
- [ ] Denying permission shows **"الإشعارات محظورة…"** and the retry button re-registers after enabling it in system settings.
- [ ] On a simulator the screen says **"الإشعارات لا تعمل على المحاكي"** (proves the diagnostic path).
- [ ] iOS: APNs key uploaded to EAS; a production (TestFlight/store) build receives push, not just the dev client.
- [ ] Android: **B3** — either ship `google-services.json` or record that the rollout is iOS-only.

Delivery rules (these are the exact server rules — test each)
- [ ] **Unclaimed chat:** a customer messages a chat nobody has taken → **every** active admin/agent receives "محادثة جديدة غير مستلمة".
- [ ] **Rate limit:** the same customer sends 4 messages in a row on that unclaimed chat → the team gets **one** alert, not four (10-minute cooldown per conversation).
- [ ] **After استلام (the user's stated requirement):** Agent A takes the chat → the customer sends another message → **only Agent A** is notified, and on **every** message (no cooldown).
- [ ] Agent B receives **nothing** for that chat once it is taken.
- [ ] **Late/danger:** an inbound message left unanswered for 6+ minutes triggers "⚠️ محادثة متأخرة" to the whole team — **requires the scheduler in B9**. Confirm the `pg_cron` job exists and calls `/api/cron/inbox-danger` about once a minute with the right secret.
- [ ] The danger alert fires **once** per unanswered customer message, not once per sweep.
- [ ] A message from a specialist's or driver's own phone number never triggers a danger alert (roster phones are excluded).

Tap behaviour
- [ ] Tap a push with the app **foregrounded** → list and thread refresh.
- [ ] Tap with the app **backgrounded** → opens the right conversation.
- [ ] Tap with the app **force-quit** → **B4**, expect a failure; it should open the conversation.
- [ ] Two devices signed in as the same employee both receive the alert exactly once each.
- [ ] Employee signs in on a phone that was previously another employee's → the old employee stops receiving alerts on it.
- [ ] Uninstall the app → the server disables the token on the next `DeviceNotRegistered` ticket (check `user_push_tokens.disabled`).

## 6. Inbox correctness

- [ ] Filter counts (جديد / محادثاتي / غير مستلمة / خطر) match the lists they open.
- [ ] The tab badge equals the جديد count and clears as chats are read.
- [ ] Opening a thread marks it read; the badge and list update, and it does not flip back to unread on the next poll.
- [ ] Search by Arabic name, by full phone, and by the last 4–6 digits all match (`phoneMatches` handles the +966/05 forms).
- [ ] Search with no result shows the "لا توجد نتائج" empty state naming the query.
- [ ] The "خطر" badge appears at exactly 6 minutes, and the row border turns red.
- [ ] A resolved conversation never appears in خطر.
- [ ] Live typing indicator appears while the customer types and disappears within ~8s of them stopping.
- [ ] **B1** — open a chat with 50+ messages and scroll up. Expect only 8 to be reachable; this must be fixed before rollout.
- [ ] Day separators are correct across midnight and across a timezone change.
- [ ] Phone numbers render LTR (leading `+`, digit groups in order) inside the RTL layout.

## 7. Sending

- [ ] Text reply reaches the customer's WhatsApp; the bubble appears in the thread.
- [ ] The draft is **not** lost if the send fails — verify with airplane mode mid-send.
- [ ] 4096-character reply is accepted; longer is rejected with a clear message.
- [ ] Photo from library, photo from camera, video, and document each send; caption rides with the first file.
- [ ] A file over 20 MB is rejected with the Arabic size message before upload starts.
- [ ] Voice note records, previews, sends, and arrives as a **push-to-talk bubble** in WhatsApp (not a plain audio file).
- [ ] Saved replies sheet inserts the right text and is editable before sending (AGENTS.md "true confirmation").
- [ ] Catalog sheet inserts service/price text correctly and prices match Rekaz.
- [ ] Denying photo/camera/microphone permission shows the Arabic guidance, not a crash.
- [ ] Incoming media (image, video, doc, voice) renders in the thread and the signed URL still opens after ~50 minutes.
- [ ] **B8** — time a send end to end. If the bubble takes >1s to appear, add an optimistic bubble before the pilot.

## 8. Orders, calendar, and Rekaz

- [ ] Calendar day-strip loads and the day survives a background/foreground cycle.
- [ ] Order detail, edit, and dispatch open and save.
- [ ] Dispatch shows the **exact outbound message, editable**, before sending (AGENTS.md).
- [ ] Two employees editing the same order → the second sees a conflict, not a silent overwrite (`expectedVersion` / `idempotencyKey`).
- [ ] Rekaz "check" reports a pending-change count; "pull" applies it and the count returns to zero.
- [ ] Rekaz unreachable → an integration warning, not a blocked screen or a retry storm.
- [ ] Customer timeline (`/orders/customer/[phone]`) loads bookings, revenue, and messages for a known customer.
- [ ] Agent (non-admin) does **not** see order prices (`canViewOrderPrices` is admin-only).

## 9. Performance & smoothness

Measure, don't eyeball. Test on the **oldest phone the team actually uses**.

- [ ] Cold start to inbox list ≤ 3s on that device.
- [ ] Inbox scroll stays at 60fps with 200+ conversations (Perf Monitor / Instruments).
- [ ] Thread scroll stays smooth with the largest thread available.
- [ ] Typing in the composer drops no frames; typing in the search bar does not blank the list.
- [ ] Tab switching is instant (no full-screen spinner on a warm cache).
- [ ] Backgrounding the app stops the polling (`focusManager` is wired to `AppState`) — confirm with a network log that requests stop.
- [ ] **B11 load test:** simulate 10 agents polling for 30 minutes. Record p50/p95 latency for `GET /conversations`. If p95 > 800ms, move the view/count filtering into SQL before the rollout.
- [ ] Battery: an 8-hour shift with the app resident does not drain more than a comparable messaging app.
- [ ] Data: measure MB/hour of polling on cellular for one agent.
- [ ] Memory does not climb across 30 minutes of open/close/scroll (leak check).
- [ ] Media upload on 4G shows progress or a disabled state — never a frozen UI.

## 10. Resilience & error handling

- [ ] Airplane mode on every screen → an Arabic error with a working retry, never a blank screen.
- [ ] Flaky network (Network Link Conditioner, 3G + 5% loss) → the app recovers without a restart.
- [ ] Server 500 on any endpoint → error state with retry.
- [ ] Deep link to a deleted/invalid conversation id → 404 state, not a crash.
- [ ] **B6** — force a render error and confirm what the user sees. Add an error boundary and crash reporting before the pilot; otherwise field crashes are invisible.
- [ ] Rapid double-tap on استلام / dispatch / send does not produce duplicates.
- [ ] Killing the app mid-upload leaves no half-sent message in the customer's WhatsApp.

## 11. Arabic, RTL & accessibility

- [ ] **B12** — fresh install, first launch: layout is RTL immediately, no restart needed.
- [ ] All copy is Arabic; no English leaks in errors, empty states, or permission prompts.
- [ ] Long Arabic names truncate rather than breaking the row layout.
- [ ] Dynamic Type at the largest accessibility size does not clip primary buttons.
- [ ] Dark mode and light mode both legible; check contrast on badges and the danger border.
- [ ] VoiceOver reads the conversation-row label (name + unread count + waiting state).
- [ ] All tap targets ≥ 44pt.

## 12. Security & privacy

- [ ] Mobile endpoints reject a request with no `Authorization: Bearer` (401) and with a token from a **non-Kiara** user (401).
- [ ] Agent A cannot read Agent B's routed conversation via a direct API call (403) — test with curl, not just the UI.
- [ ] An agent cannot reply into a chat assigned to someone else (`TAKEOVER_REQUIRED`).
- [ ] The `SUPABASE_SERVICE_ROLE_KEY` is server-only and never bundled into the app (grep the JS bundle for it).
- [ ] Media signed URLs expire and are not guessable.
- [ ] The app never logs customer phone numbers or message bodies to the device console in a release build.
- [ ] Privacy policy / terms links in the account screen resolve (App Store requirement).
- [ ] Customer data is not left in a plaintext cache after sign-out.

## 13. Release readiness

- [ ] iOS: App Store Connect app `6800355271` set up; screenshots, Arabic description, privacy nutrition labels (contacts/photos/microphone all declared).
- [ ] Permission strings in `app.json` are the ones that will appear in review (mic, photos, camera — currently Arabic, confirm that is intended).
- [ ] TestFlight build installed by at least 2 real employees for 3 days before the wide rollout.
- [ ] A rollback path exists (previous build available in TestFlight; server API is versioned via `X-Kiara-Api-Version`).
- [ ] Someone owns the on-call channel for the first week, with a written escalation path.

## 14. Go / no-go gate

Do not roll out to the whole team until **all** of these are true:

1. B1 fixed — full message history is reachable in a thread.
2. B2 verified — Hanan has an admin `team_members` row and receives push.
3. B3 resolved — Android push works, or the rollout is explicitly iOS-only.
4. B5 decided — Model A or Model B written down and tested.
5. B9 verified — the danger sweep is actually scheduled in production.
6. B6 addressed — an error boundary plus crash reporting are shipping.
7. Section 5 notification matrix passes end to end on real hardware.
8. Section 9 load test passes at the real agent count.
9. B13 resolved — the app builds locally on a documented, pinned Xcode version.
10. Sections 6, 7, 9 and 11 have actually been executed against a running build (they are currently unverified).

Suggested rollout: 2 employees for 3 days → 5 employees for 1 week → whole team.
