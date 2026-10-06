# Mobile app performance audit — screen by screen

**Date:** 2026-09-21
**Scope:** `apps/mobile` (Expo SDK 57 / RN 0.86, New Arch + Hermes) and the `/api/mobile/v1` routes it depends on.
**Question asked:** why does the app feel slow, laggy, and slow to load — and what makes it lighter and faster.

---

## 0. How this was measured

| What | How |
|---|---|
| Client render cost | Static read of every screen under `app/`, every component under `components/`, list configs, memo boundaries, animation usage |
| Bundle | Source-map breakdown of `dist/_expo/static/js/ios/entry-*.hbc.map` |
| Server cost | Replayed each screen's actual query pipeline against the production Supabase project (`ugbplqgrheovlfgolsjf`) with the service key, timing every hop and measuring payload bytes |
| Network baseline | `curl` timings against `kiara-chat-eight.vercel.app` (fra1) |

Production data at time of audit: **1 132 conversations**, **53 042 messages**, 42 label assignments, 11 team member rows.

**Ruled out** (checked, not a problem): Hermes and New Architecture are both on; `expo-dev-client`'s heavy deps and its network inspector are `debugOnly` / `#if DEBUG`, so release builds are clean; Supabase JWTs are ES256 so `getClaims()` verifies locally with a process-cached JWKS — no auth round trip per request; `vercel.json` already pins `fra1` next to the database.

---

## 1. The headline

The app is not mainly slow because of React. **It is slow because the busiest endpoint in the app reads the entire `conversations` table on every single call, and the client calls it far more often than anyone intended.**

Everything else in this report is real but secondary.

### 1.1 `GET /conversations` reads the whole table, every time

`src/lib/mobile/conversations.ts:listMobileConversations` → `src/lib/inbox.ts:51 listAllConversations`:

```ts
for (let offset = 0; ; offset += batchSize) {          // batchSize = 1000
  const { data } = await supabase.from("conversations")
    .select(CONVERSATION_COLS)                          // includes the metadata jsonb
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("last_message_at", { ascending: false })
    .range(offset, offset + batchSize - 1);
  ...
}
```

Every filter, every tab, every search, every view is applied **in JavaScript afterwards**, then `.slice(offset, offset + 50)` throws away 1 082 of the 1 132 rows it just loaded.

Measured, replaying the exact pipeline:

```
 page off=0          418 ms   639 KB   1000 rows
 page off=1000       156 ms    65 KB    132 rows   (sequential — waits for page 1)
listAllConversations 574 ms          1132 rows

 classification (4 parallel queries)  271 ms wall
   specialists                         97 ms    4 KB
   drivers                            215 ms    2 KB
   conversation_labels                264 ms    3 KB
   label assignments (inner join)     265 ms   66 KB   ← joins the whole table again
 lastMessagesFor (50 previews)        205 ms  198 KB    613 rows fetched to produce 50

≈ 1 057 ms of database work, ≈ 900 KB over the wire, to render 50 rows.
```

From fra1 the per-hop latency is lower, but the bytes, the JSON parse, and the sequential page walk are identical. Realistically **400–700 ms server-side per inbox request**, on top of ~215 ms of function + network overhead measured against production.

### 1.2 The client calls it far more than once

Four multipliers stack on top of that cost:

1. **Two list queries are always mounted.** `app/(app)/(tabs)/_layout.tsx:23` runs `useConversations("new", "", …)` for the tab badge. The comment says it "shares the inbox screen's cache entry, so this adds no extra traffic" — that is true only while the inbox is on the default `new` view. The moment an employee taps "كل المحادثات" or any other tab, the query key diverges and **two full table scans are live at once**, both refetching on every trigger below.

2. **Every realtime message invalidates all of them.** `providers/inbox-live-provider.tsx:216`:
   ```ts
   queryClient.invalidateQueries({ queryKey: ["conversations"] })
   ```
   That is every cached list, for every view / search / filter combination — with no debounce. On a busy afternoon each inbound WhatsApp message triggers a full re-scan of the table per active list query.

3. **Infinite queries refetch *every* page.** `maxPages` is not set anywhere. An employee who has scrolled three pages deep pays **three sequential full-table scans** per invalidation — roughly 2 s of server work for one arriving message.

4. **Every distinct search string is a new cache key** (`queryKeys.conversations(view, search, filters)`), so it is a new full scan. `useDeferredValue` reduces the number of keystrokes that fire, it does not make any of them cheap.

**This is the single biggest cause of "the app is slow."**

---

## 2. Screen by screen

### 2.1 Cold start — `app/index.tsx` → `(tabs)` → inbox

**Three blocking network waits before the first pixel of content.**

```
splash → AuthProvider.getSession() (keychain, up to 8 s timeout)
       → <LoadingScreen/> → GET /bootstrap  (blocks the whole app)
       → <LoadingScreen/> → GET /conversations  (full table scan, §1.1)
       → first content
```

`app/index.tsx:11` and `app/(app)/(tabs)/_layout.tsx:27` both hold a full-screen spinner until `/bootstrap` resolves. But the inbox only needs bootstrap for two cosmetic things — the agent-name map behind the "الموظفة: …" badge and the label colour lookup. The list itself does not depend on it.

**Bundle:** 4.5 MB of Hermes bytecode from 8.18 MB of source. Largest contributors:

```
 2053 KB  react-native          955 KB  react-native-reanimated
 1232 KB  expo-router           427 KB  @supabase/auth-js
  423 KB  /app                  388 KB  /components
  155 KB  react-native-webrtc   222 KB  /lib
```

Not pathological, but `react-native-webrtc` (155 KB) is only reachable from the call button in one chat header, and `lib/driver-trip-tracking.ts` is imported for side effects at the top of `app/_layout.tsx` — pulling `expo-location` + `expo-task-manager` into the startup path for *every* user, including office staff, behind a `TRIP_TRACKING_ENABLED = false` flag that makes the whole module dead code today.

### 2.2 Inbox — `app/(app)/(tabs)/inbox/index.tsx`

The data-layer problems are §1. The render side is already carefully done (`ConversationRow` is `memo`'d, `renderRow` is a `useCallback`, typing is a `useSyncExternalStore` subscription per row rather than a context value — that last one is genuinely good work). Two things still hurt:

**The row is very heavy.** Each `ConversationRow` renders, worst case: an `Avatar` (View + Text), a header row (2 Texts), a preview row (`DeliveryTicks` with up to 2 icons, a media icon, a Text, a `CountBadge`), then a badge strip that can carry **eight or more** `Badge` components — 24h window, assignee, CS status, booking stage, contact outcome, group/specialist/driver/unclaimed, overdue, "رُدّ من واتساب", plus one per label. Each `Badge` is View + `IconSymbol` + Text.

That is **~40 native views per row**. At 8–10 visible rows the inbox is a 350–400 view surface. On iOS every `IconSymbol` is an `expo-image` view resolving an `sf:` source (`components/ui/icon-symbol.tsx:135`), so those 400 views include ~100 image views.

**Entrance animations replay during scroll.** `app/(app)/(tabs)/inbox/index.tsx:657`:
```tsx
<Animated.View entering={FadeIn.delay(Math.min(index, 8) * 24).duration(200)}
               exiting={FadeOut.duration(140)}>
```
A virtualized list mounts and unmounts cells continuously as you scroll, so this fade is not a one-time entrance — it fires on every cell mount, and `exiting` forces Reanimated to keep each unmounting cell alive for an extra 140 ms. This is the "lag" while scrolling the inbox.

**Loading state adds 20 infinite animations.** `SkeletonList` renders 5 × `SkeletonRow` = 20 `Skeleton`s, each with a `withRepeat(-1)` loop (`components/ui/skeleton.tsx:34`) — running at exactly the moment the JS thread is parsing a 900 KB response.

### 2.3 Chat — `app/(app)/conversation/[id].tsx`

**Four parallel requests on open**, plus a full-screen spinner until the slowest lands (`:540 — if (conversation.isLoading) return <LoadingScreen/>`). No data is seeded from the inbox row the user just tapped, so opening a chat is always a cold wait.

| Request | What it costs |
|---|---|
| `GET /conversations/:id` | `getConversationById` + `getConversationMessages(limit: 8)` + reminder + labels + `toClassifiedMobileConversation` (which re-runs the whole specialists/drivers/labels classification), then a **sequential** `findSharedLocationsInConversation` after the `Promise.all` |
| `GET /conversations/:id/messages?limit=25` | Fires **in parallel with the above**, re-reads the same conversation and re-fetches messages. The 8 messages the detail route returned are immediately deduped away — wasted |
| `GET /conversations/:id/call-permission` | Four sequential awaits including a **live Meta Graph reconciliation** (`src/app/api/mobile/v1/conversations/[id]/call-permission/route.ts:52-58`) |
| `GET /conversations/:id/notes` | Correctly gated on the sheet being open — no issue |

`MESSAGE_PAGE_SIZE = 8` (`src/lib/inbox.ts:97`) means the detail route's message page is almost useless on its own — it is one screenful at most, so the second request is mandatory to fill the view.

**Render side:**
- `renderItem` is an **inline arrow** (`:915`), so `memo` on `MessageBubble` cannot hold — every list re-render re-renders every cell.
- Even with a stable `renderItem` it would not help: every refetch produces fresh message objects from JSON, so prop identity changes anyway. The `messages` → `chatItems` memo chain (dedupe + `sort` + day-separator build, `:491-512`) re-runs on every poll and every realtime event, over the whole loaded thread.
- Every bubble carries `exiting={FadeOut.duration(220)}` (`:922`), keeping unmounting cells alive through scroll.
- **Each media message fires its own `GET /media?path=…`** to sign a URL (`components/inbox/media-attachment.tsx:47` → `lib/queries.ts:467`). A thread with ten images costs ten extra round trips as you scroll. `expo-image` also has no `recyclingKey`, so recycled cells flash the previous image.

The composer is correct — `draft` is local state, so typing does not re-render the message list.

### 2.4 Orders / calendar — `app/(app)/(tabs)/orders/index.tsx`

The `/orders/calendar` route is the **best-built endpoint in the app** — three independent reads issued together, bounded date range, a documented reason for the shape. No complaint.

The screen around it:
- Every tap on the day strip changes `from`/`to` (`selectedDay − 3` … `+7`), which is a **new cache key and a fresh request**. The ±3/±7 window was meant to make neighbouring days instant, but because the window slides with the selection, moving one day forward invalidates it anyway. Only a fixed, snapped window (e.g. per calendar week) actually gets the cache hit that was intended.
- `refetchInterval: 60_000` on top of a 30 s `staleTime`.
- `DayStrip`'s `renderItem` is inline (`:123`).

**`components/orders/schedule-grid.tsx` (the جدول view) is the worst frame-rate offender in the app.** The sticky names row is driven from the body's scroll position through JS:

```tsx
scrollEventThrottle={16}
onScroll={(e) => namesRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false })}
```

That is 60 JS-thread callbacks per second, each issuing a native `scrollTo` — while the grid also renders every slot card absolutely positioned with no virtualization. Horizontal scrolling in the grid will stutter on any mid-range Android device.

### 2.5 Reports — `app/(app)/(tabs)/reports/*`

Correctly gated: only one report query is enabled at a time, and the whole tab is owner-only. But the customer-service report is genuinely expensive and it **polls every 30 seconds** (`lib/queries.ts:653-654`).

`src/lib/customer-service-report.ts` issues ~12 paged reads in parallel, including two passes over `messages` (53 k rows) joined `conversations!inner`, plus the full `conversations` table, plus `operation_events` twice — each through `pageRows()` which walks 1 000 rows at a time. On top of that, `memberEmails()` (`:319`) calls `admin.auth.admin.getUserById` **once per team member** — 11 separate Auth Admin API round trips per report build.

**`app/(app)/(tabs)/reports/customer-service/[personId].tsx:373`** renders `handledChats` — an infinite query paged 20 at a time — with `.map()` inside a plain `ScrollView`. Nothing is virtualized and nothing is capped: scroll to load more and every row stays mounted, then the parent's 30 s poll re-renders all of them.

### 2.6 Customer profile — `app/(app)/customer/[phone]/index.tsx`

`GET /customers/:phone/timeline` makes a **live lifetime call to Rekaz** (the route sets `maxDuration = 30` and says so in its own comment). This screen will always be slow; it needs a visible progressive shape, not a spinner. The list itself is a `FlatList` with `memo`'d rows — the client side is fine.

### 2.7 Field app — `app/field/*` (specialists and drivers)

`src/lib/field-staff.ts:619`:
```ts
export async function listFieldOrders(session, options) {
  await touchFieldStaffActivity(session.accountId);   // a WRITE, awaited, before the read
  return loadOrdersForSession(session, options);
}
```
Same in `getFieldOrder` (`:632`). Every list load and every detail load pays a serial write round trip before the read starts — and these poll every 30 s and 20 s respectively.

`app/field/orders/[id].tsx:98` constructs a **new `Intl.DateTimeFormat` on every call** of its `time()` helper, inside the component. On Hermes each construction is on the order of a millisecond; this screen calls it for every timestamp on every render.

### 2.8 Campaigns — `components/campaigns/campaign-audience.tsx`

Already capped at `VISIBLE_ROWS = 60` with an explicit "تظهر أول 60 عميلة" message, rendered as plain Views inside the sheet's `ScrollView`. Documented as a deliberate choice. Acceptable at 60; do not let that cap grow.

### 2.9 Background load, all screens

Running constantly while the app is foregrounded:

| Source | Interval |
|---|---|
| `useEmployeePresence` heartbeat | 45 s POST |
| `useOrdersCalendar` | 60 s |
| `useOrders` | 60 s |
| `useCustomerServiceReport` | 30 s (expensive, §2.5) |
| `useOrder` / `useOrderReminder` | 20 s |
| `useFieldOrders` / `useFieldOrder` | 30 s / 20 s |
| `useCampaigns` / `useCampaignTemplates` | 20 s / 30 s |
| `useRekazCheck` | 5 min |
| Realtime invalidation | per inbound message, unbounded |

---

## 3. What to do, in order

### P0 — fix the inbox endpoint (this is 80 % of the win)

**3.1 Push the inbox query into Postgres.** Replace `listAllConversations` + JS filtering with a SQL query that filters, sorts, and paginates in the database. The view predicates in `matchesView` map cleanly onto SQL over columns that already exist (`unread_count`, `assigned_to`, `last_message_at`, `last_inbound_at`, `status`), and the metadata-based ones (`cs_status`, `booking_stage`, `contact_outcome`, `section`, `handled_on_whatsapp`) are jsonb reads that a GIN index or generated columns cover. Do the tab counts as a single grouped aggregate rather than nine array filters over 1 132 objects.

Expected: ~1 000 ms → under 100 ms, and ~900 KB → ~40 KB.

**3.2 Stop transferring `metadata` for rows you will discard.** Even before the full rewrite, selecting the metadata jsonb for all 1 132 rows is 238 KB of the payload. Promote the handful of fields actually read into real columns, or select metadata only for the 50 rows on the page.

**3.3 Set `maxPages: 3` on `useConversations`** (`lib/queries.ts:159`). One line; immediately caps the refetch storm from 3× to 1× for deep-scrolled lists.

**3.4 Debounce the realtime invalidation** in `providers/inbox-live-provider.tsx:216`. Coalesce bursts into one invalidation per ~1.5 s, and scope it to the *active* list query rather than the whole `["conversations"]` prefix.

**3.5 Make the tab badge stop being a second full query.** Either read the count from whichever list query is already mounted, or add a tiny dedicated `GET /conversations/counts` endpoint. Today it silently doubles inbox load as soon as an employee leaves the default view.

### P1 — make screens open instead of spinning

**3.6 Un-block startup on `/bootstrap`.** Render the inbox as soon as auth resolves; let the agent-name and label-colour lookups fill in when bootstrap lands. Removes one full round trip from every cold start.

**3.7 Seed the chat screen from the inbox cache.** Use `initialData` / `placeholderData` from the `ConversationSummary` the user just tapped so the header and name paint immediately instead of showing `LoadingScreen`.

**3.8 Collapse the chat's two message requests into one.** Either raise `MESSAGE_PAGE_SIZE` to 25 and drop the separate `useConversationMessages` first page, or have the detail route skip messages entirely. Today the app fetches messages twice and throws one set away.

**3.9 Return signed media URLs inline with the messages payload.** The server already knows the storage paths; signing them in the same response removes one round trip per media message.

**3.10 Defer `call-permission`.** It is a live Meta call behind a pill most employees never use. Fetch it on first interaction, or accept a cached value and reconcile in the background.

### P2 — render and frame rate

**3.11 Cap the inbox badge strip.** Show at most 2–3 badges plus an overflow indicator. This is the single largest reduction in view count per row, and it is also a design improvement — eight badges on one row is not readable anyway.

**3.12 Remove `entering`/`exiting` from virtualized cells** — inbox rows (`inbox/index.tsx:657`) and chat bubbles (`conversation/[id].tsx:922`). Keep the `exiting` fade only for the explicit delete case if it matters.

**3.13 Hoist the chat's `renderItem` into a `useCallback`** (`conversation/[id].tsx:915`).

**3.14 Move the schedule grid's sticky-header sync onto the UI thread** with Reanimated's `useAnimatedScrollHandler` + `scrollTo` worklet, replacing the 60 fps JS callback.

**3.15 Virtualize `handledChats`** in the CS employee report, or cap it the way `campaign-audience` already does.

**3.16 Consider FlashList** for the inbox and chat lists. With rows this heavy, cell recycling is worth more here than in a typical app. This is the one item that is a real migration rather than a patch — do it after 3.11 and 3.12, and measure first.

### P3 — housekeeping

**3.17 Drop the dead `driver-trip-tracking` import** from `app/_layout.tsx:8` while `TRIP_TRACKING_ENABLED === false`, or lazy-require it behind the flag.

**3.18 Move `touchFieldStaffActivity` off the read path** (`src/lib/field-staff.ts:623, 632`) — fire and forget, or fold it into the same statement.

**3.19 Hoist the per-call `Intl.DateTimeFormat`** in `app/field/orders/[id].tsx:98` and `components/orders/service-timing-card.tsx:34` to module scope, like every other formatter in the codebase already is.

**3.20 Revisit the polling table in §2.9.** With realtime already wired, most of these intervals are belt-and-braces. The 30 s customer-service report poll is the one to cut first — it is by far the most expensive query in the app and nobody watches a report update live.

---

## 4. Expected outcome

| | Now | After P0 | After P0+P1 |
|---|---|---|---|
| Inbox load (server) | 400–700 ms | < 100 ms | < 100 ms |
| Inbox payload | ~900 KB | ~40 KB | ~40 KB |
| Cold start to content | 3 sequential round trips | 3 | 2 |
| Chat open | 4 parallel requests, full spinner | 4, faster | 2–3, paints immediately |
| Cost per inbound message | 1–3 full table scans × live lists | 1 debounced indexed query | same |

P0 alone is roughly a day of work on the server side and four one-line client changes, and it is where almost all of the perceived slowness lives.
