# Performance baseline — 2026-11-05

The "before" numbers for the speed plan. Compare each phase against these with the
same queries (phone reports in `mobile_diagnostics`, database stats in
`extensions.pg_stat_statements`).

## Phone load times, last 7 days

Wafaa's phone left out (it was stuck renewing its login), averages over 30 s
left out (app suspended mid-request).

| Endpoint | Calls / 7 days | Typical (p50) | Slow (p90) |
|---|---:|---:|---:|
| `/conversations` (inbox list) | 45,302 | 874 ms | 2,399 ms |
| `/activity/heartbeat` (online ping) | 40,300 | 469 ms | 6,762 ms |
| `/conversations/:id/messages` | 18,677 | 591 ms | 1,737 ms |
| `/conversations/:id` | 16,070 | 735 ms | 2,238 ms |
| `/orders/calendar` | 8,871 | 798 ms | 2,233 ms |
| `/conversations/:id/call-permission` | 8,428 | 1,281 ms | 2,266 ms |
| `/field/orders/:id` | 5,911 | 1,287 ms | 2,607 ms |
| `/field/orders` | 5,104 | 883 ms | 2,135 ms |
| `/bootstrap` | 4,080 | 814 ms | 2,454 ms |

## Database time, 21.7 hours since the 2026-11-04 restart

Total query time: 5,435 s (about 250 s per hour).

| Share | Calls | Mean | What |
|---:|---:|---:|---|
| 21.8% | 27,352 | 43 ms | Full inbox read (`listAllConversations` / `listConversations`) |
| 11.3% | 9,118 | 68 ms | All label assignments (`getLabelAssignments`) |
| 6.9% | 11,681 | 32 ms | Online ping (`record_employee_app_presence`) |
| 6.8% | 8,560 | 43 ms | Inbox "last message" previews (`lastMessagesFor`) |
| 5.2% | 7,399 | 39 ms | Chat thread page (`getConversationMessages`) |
| 5.0% | 3,628 | 76 ms | Shared-location search, map links (`findSharedLocationsInConversation`) |
| 4.7% | 3,626 | 70 ms | Shared-location search, pins |
| 4.5% | 50,928 | 5 ms | Live channel sign-in (`realtime.authorize`) |

These include Wafaa's login-renewal loop, fixed in `8d1ed61`; part of the inbox
and live-channel numbers came from it.

## Size of the data

2,504 conversations (1,198 active in the last 30 days, none archived), 1.3 MB of
rows read whole on every inbox load. Conversation `metadata` is 886 kB of that;
`field_sessions` alone is 384 kB and the inbox list never uses it.
