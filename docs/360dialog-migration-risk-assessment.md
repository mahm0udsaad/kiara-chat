# Twilio to 360dialog Migration Risk Assessment

**Prepared:** 11 September 2026  
**System:** Kiara WhatsApp number `+966 50 842 1748`  
**Decision:** **NO-GO today. Do not delete the Twilio sender.**

## Executive decision

The migration is feasible and most of Kiara's current WhatsApp features can be preserved. The engineering work is moderately difficult (**6/10**), while moving the live number is high risk (**8/10**) because the number is already used by the team and there is no instant rollback after Meta transfers it.

Kiara is not ready to cut over today for three independently sufficient reasons:

1. Meta currently reports that the display name **“Kiara Spa” was rejected**, while the replacement **“Kiara” is still in review**. 360dialog states that a number cannot be migrated until its display name is approved.[^1]
2. All five live templates are **Active – Quality pending**, not `GREEN`. Only templates that are both `APPROVED` and `GREEN` are automatically duplicated during migration.[^2]
3. Two-step verification is currently enabled. It must be disabled immediately before the migration, not days in advance.[^1]

The safe sequence is: finish and test the 360dialog integration on a test number, obtain the display-name approval, establish a template plan, configure billing, pause staff sends, disable 2FA, and then use 360dialog's **existing-BSP migration flow**. Deleting the Twilio sender first is not the migration flow and unnecessarily increases the chance of a long outage or asset loss.

## What can be done today

**Today: apply and prepare — yes. Transfer the production number — no.**

The following preparation is safe to complete without affecting Twilio:

1. Create the 360dialog Client Hub account.
2. Choose Regular ($59/€49), or Premium only for the migration month if the faster support SLA is required.
3. Add the payment method, invoicing details, credit balance and automatic replenishment.
4. Open a 360dialog support ticket with the business portfolio name, WABA ID, phone-number ID and production number; ask them to validate eligibility and the treatment of the five `Quality pending` templates.
5. Continue the display-name review in Meta and ask Meta/360dialog Support to resolve the rejected “Kiara Spa” name or approve “Kiara.”
6. Implement and test Kiara's 360dialog transport, webhook, media archiving, template mapping and provider feature flag.

Do **not** disable 2FA, enter the production OTP, click **Finish** in Embedded Signup, remove the Twilio credit line, or delete the Twilio sender during preparation. Those actions belong in the controlled cutover window.

A same-day transfer becomes technically possible only if the display name changes to `APPROVED`, all migration checklist answers are “yes,” the new integration has passed production-equivalent tests, payment is confirmed, and the team explicitly accepts the loss/recreation risk for every non-GREEN template. The published 360dialog flow is: **Add number → choose plan/payment → enter the existing number → select “Yes, Business API” → complete all requirement questions → Embedded Signup → select the existing Meta Business Portfolio → receive the expected existing-BSP warning → request and enter OTP → wait for Connected**.[^1] It does not instruct an API customer migrating from another BSP to delete its existing sender first.

## What customers will experience

If the official migration succeeds, customers keep messaging the **same WhatsApp number** and continue to see the same conversation thread on their phones. They do not need to save a new contact or install anything. The display name, number quality rating, messaging limit, and official-business status are designed to transfer.[^2]

There will still be a short operational interruption during cutover. During that interval:

- Staff sends may fail or remain queued.
- New inbound messages may be retried by WhatsApp but may not appear in Kiara until the 360dialog webhook is healthy.
- Delivery/read receipts for messages sent through Twilio before cutover may arrive late.
- A customer who receives no reply will see the same number and thread, but the business may temporarily look unresponsive.

Provider-side chat history does **not** migrate.[^2] This is less serious for Kiara because its application history is stored in Supabase: the audit found 607 conversations, 15,549 Twilio-linked message records, and 3,212 archived media records. That history must remain read-only and visible after the provider changes. It should not be re-imported as new messages.

## Can Kiara keep its existing features?

| Current capability | After migration | Work or limitation |
|---|---|---|
| Send/receive text | Yes | Replace Twilio REST requests with 360dialog/Cloud API requests. |
| Images, documents, audio and video | Yes | Media upload/download and retention rules differ. Retrieved 360dialog media URLs are confidential and expire after five minutes, so Kiara must archive media asynchronously.[^3] |
| Delivery and read status | Yes | Re-map Meta status payloads and errors to Kiara's internal statuses. |
| Reply inside the 24-hour service window | Yes | Sending rules stay the same, but Meta begins charging for many service messages on 1 October 2026. |
| Send outside the 24-hour window | Yes, with an approved template | Same Meta rule as Twilio. Template availability is a current blocker. |
| Template variables | Yes | Map variables to Meta `components`; Twilio `HX...` Content SIDs cannot be sent through 360dialog. |
| Quick-reply and call-to-action buttons | Yes | Rebuild the payload mapping and test every template. |
| Team inbox and existing chat list | Yes | These are Kiara/Supabase features, not features supplied by Twilio. |
| Campaign sending | Yes | Keep Kiara's campaign engine; change its transport and enforce category/opt-in rules. No campaign is currently active. |
| Appointment/order automations | Yes | Change provider transport, preserve idempotency, and test Arabic/English content and variables. |
| Existing Supabase history | Yes | Keep the same database identifiers and provider metadata; do not overwrite old Twilio SIDs. |
| WhatsApp calling/ringing | Not migration-day parity | It is a separate Calling API/SIP project with eligibility and customer-permission rules. The current 250 business-initiated-message limit may be below calling eligibility. Do not make it part of the first cutover. |

The result is close to full **business-feature parity**, but not API parity. Twilio-specific Content SIDs, webhook signatures, form payloads, error codes and media URLs must all change.

## Template answer: can we send the same templates?

**The same wording and buttons can usually be recreated, but the five current templates are not guaranteed to be available immediately after migration.**

Meta/360dialog duplicates only templates that are `APPROVED` and have `quality_score=GREEN`. Duplicated templates are reviewed again, may be reclassified or rejected, and begin with an `UNKNOWN` quality rating for at least the first 24 hours.[^2] Low-quality, rejected and pending templates do not migrate automatically.

Current live inventory:

| Template | Current category | Recent delivered | Live state | Migration expectation |
|---|---:|---:|---|---|
| `oferr_gift_hxe04be3b85f30fd4fd380cfb1d974e465` | Marketing | 1 | Quality pending | Will not auto-duplicate today |
| `g_hx6bd8b299be724c282c19f76377903d63` | Marketing | 6 | Quality pending | Will not auto-duplicate today; recently reclassified from Utility |
| `kiara_number_notice_hx9ed2953b5f75cadc488e2cd0add1292b` | Marketing | 390 | Quality pending | Will not auto-duplicate today |
| `kiara_conversation_opener_hx21822b343fb1d89bed64aa0ef27fcd6c` | Marketing | 23 | Quality pending | Will not auto-duplicate today |
| `kiara_booking_followup_hxbb5e5dbfc42600f2678e55b38445cdac` | Utility | 101 | Quality pending | Will not auto-duplicate today |

Required mitigation:

1. Export the exact body, language, category, header, footer, buttons, example values and variable order for every template.
2. Remove the Twilio `HX...` identifier from Kiara's application contract. Use a provider-neutral template key mapped to `{provider, template_name, language, components}`.
3. Ask 360dialog Support to confirm in writing whether these `Quality pending` templates can be duplicated in this specific migration. Their published rule says no.
4. Prepare an approved-template fallback for every critical operation, especially booking follow-up and conversation opening.
5. Do not cut over until a real 360dialog test message has been delivered for every required template.

## Cost and payment model

### How payment works with 360dialog

There are two components:

1. **360dialog subscription:** Regular is **€49 or $59 per number per month**. It includes the core API and 80 messages/second. Kiara does not need 360dialog's Inbox, Sendout or Automation products because those capabilities already exist in Kiara. Premium is useful only if the team wants the under-30-minute support SLA during migration; Advanced is unnecessary at Kiara's volume.[^4]
2. **Meta usage fees:** charged by delivered message, using the recipient's country and the Meta category/rate. 360dialog says it passes these rates through without markup.[^5]

In the 360dialog Hub, add a card, legal billing details and sufficient credit before migration. The credit balance is consumed by messaging. Enable automatic replenishment. 360dialog issues a reconciliation invoice on the first day of the month and may apply a **4% payment-processing fee** to the payable amount.[^6] A failed automatic payment requires manual payment.

There is an additional deadline: from **1 October 2026**, Meta will charge for service messages after the first 1,000 per phone number per month. Meta/360dialog also warn that the responsible billing entity must have a payment method registered by **30 September 2026**, or service-message delivery can stop.[^7] During onboarding, obtain written confirmation from 360dialog that its billing relationship covers Kiara's number and identify whether any separate Meta Billing Hub method is required.

### Kiara's measured 30-day cost model

Live Meta insights for 14 August–10 September 2026 showed:

- 10,442 messages sent
- 12,122 messages received
- 10,427 delivered outbound messages by category: 420 Marketing, 114 Utility and 9,893 Service
- 532 paid outbound messages and 9,895 free messages
- Almost all recipients are assumed to be Saudi numbers for this estimate

Twilio charges $0.005 for **each inbound and outbound message**, in addition to Meta's charges.[^8]

| Monthly estimate | Twilio now | 360dialog Regular now | 360dialog Regular from 1 Oct 2026 |
|---|---:|---:|---:|
| Provider charge | about **$112.82** | **$59.00** | **$59.00** |
| Meta Marketing/Utility/Service | about **$22.26** | about **$22.26** | about **$120.57** |
| 360dialog payment processing | n/a | up to about **$0.89** | up to about **$4.82** |
| Approximate total before tax | **$135.08** | **$82.15** | **$184.39** |

Calculations:

- Twilio handling: `(10,442 + 12,122) × $0.005 = $112.82`.
- Current Saudi Meta rates: Marketing `$0.0501`, Utility `$0.0107`, Service `$0`; the 360dialog calculator returns about `$22.26` for this mix.[^9]
- From 1 October: `(9,893 − 1,000 free Service) × $0.0107 + 114 × $0.0107 + 420 × $0.0576 = $120.57`.[^7]

This means 360dialog currently saves roughly **$53 per month** at the measured volume. After the October Meta change, the absolute bill rises sharply with either provider; the provider-only saving remains roughly **$49–54 per month** before tax and foreign-exchange effects. The October increase is a Meta-wide price change, not a 360dialog migration fee.

These are planning estimates, not an invoice. Costs change if customers are outside Saudi Arabia, if the message mix changes, if messages fall inside the 72-hour free-entry window, if templates are reclassified, or if Meta changes its rates. Also budget for VAT, card/FX costs and any failed-message fees.

## Risk register

| Risk | Probability | Impact | Control / exit criterion |
|---|---|---|---|
| Display name blocks migration | Certain today | Critical | Wait until the active name is `APPROVED`; capture evidence immediately before cutover. |
| Required templates do not migrate | Certain today | Critical | Get `GREEN` status or recreate/approve/test each required template on the destination path. |
| Twilio sender is deleted before 360dialog is ready | Medium if current plan is followed | Critical | Never use deletion as step one. Use the existing-BSP migration flow and OTP. |
| No quick rollback after Meta transfer | High | Critical | Test first, schedule low traffic, assign a decision owner, and keep a manual fallback number. A return to Twilio requires another provider migration. |
| Wrong template/variable reaches customer | Medium | High | Provider-neutral mappings, golden-payload tests and editable final-message confirmation in Kiara. |
| Inbound webhook is rejected or times out | Medium | Critical | Accept 360dialog JSON, validate configured secret header, store event, return 200 within five seconds, then process asynchronously.[^10] |
| Duplicate messages from retries | Medium | High | Enforce idempotency on provider message ID and event type; never create two records for a retry. |
| Delivery/read status regresses | Medium | High | Map `sent`, `delivered`, `read`, `failed` and pricing objects; reconcile sample events before enabling all staff. |
| Media disappears | Medium | High | Download and archive immediately; do not store a five-minute provider URL as the durable attachment.[^3] |
| Late Twilio callbacks corrupt new state | Medium | Medium | Keep Twilio webhook and credentials read-only for at least 30 days; associate callbacks with provider + provider ID. |
| Messages are sent during the cutover gap | High | High | Announce a send freeze, pause automations/campaigns, drain queues, and display maintenance state to staff. |
| 24-hour-window logic changes behavior | Medium | High | Use Meta timestamps, not local guesses; require approved template outside the window. |
| Template reclassification raises cost | Medium | Medium | Monitor category/status daily; `g_hx...` has already changed from Utility to Marketing. |
| Insufficient billing balance stops delivery | Medium | Critical | Add card, enable auto-replenishment, set low-balance alerts, and verify October payment responsibility. |
| Message quality or limits fall after cutover | Low–medium | High | Keep opt-in proof, opt-out processing and rate controls; monitor quality and limit in Meta and 360dialog. |
| Secrets are exposed or mixed between providers | Medium | Critical | Store `D360_API_KEY` in server-only secrets, rotate at cutover, and never expose it to the mobile app. |
| Staff assume calling/ringing is included | Medium | Medium | Treat Calling API as a separate phase with separate eligibility, permission, UI and monitoring. |
| Support response is too slow during outage | Medium | High | Consider Premium for the migration month or pre-book a 360dialog support contact; Regular's published first-response SLA is under four hours.[^4] |

## Required engineering changes

The repository already has a useful transport abstraction, so this is a replacement rather than a rewrite. The principal work is approximately **800–1,200 changed/new lines across 10–14 functional files**, plus tests:

- Add `src/lib/transport/360dialog.ts` implementing the existing transport contract.
- Extend provider types from `"twilio" | "openwa"` to include `"360dialog"` without changing old records.
- Add a 360dialog JSON webhook for inbound messages, statuses, errors and pricing metadata.
- Acknowledge the webhook first and move media/database work to an asynchronous worker.
- Replace Twilio signature validation with a secret header configured in 360dialog.
- Replace `twilio-content.ts` calls and `HX...` Content SIDs with provider-neutral templates and Meta components.
- Update campaigns, booking follow-ups, quick replies, buttons and media sends.
- Preserve Twilio webhook/status routes for historical callbacks during the transition.
- Add provider-specific observability: webhook latency, retries, unhandled event types, send failures, delivery latency, category and billable flag.
- Put provider selection behind a server-side feature flag so code can be deployed and tested before the number moves.

Estimated delivery is **8–12 engineering working days**, followed by a low-traffic cutover window. No mobile-store rebuild should be required if the change remains server-side; an app update is required only if mobile code contains provider-specific behavior or new calling UI.

## Safe cutover runbook

### Before scheduling

- [ ] Active display name is `APPROVED` in Meta.
- [ ] Business portfolio and source WABA remain approved.
- [ ] Every critical template has a tested destination strategy; no dependency on pending auto-duplication.
- [ ] 360dialog test number passes inbound, outbound, image, document, template, button, delivery and read tests.
- [ ] 360dialog card, credit, auto-replenishment and billing owner are confirmed.
- [ ] 360dialog webhook p95 response time is below one second and always below five seconds.
- [ ] Feature flag, monitoring dashboard, alerting and support contacts are ready.
- [ ] Staff owner, technical owner and explicit go/no-go authority are named.

### Cutover window

1. Pause campaigns, appointment reminders and all staff sending.
2. Drain outbound jobs and snapshot queue counts, template definitions, environment configuration and recent message state.
3. Confirm the number can receive the OTP by SMS or voice.
4. Disable two-step verification immediately before migration.
5. Start 360dialog onboarding, answer that the number is already connected to another WhatsApp Business API provider, and use the migration/OTP path.[^1]
6. Wait until 360dialog reports the number connected; configure and verify the production webhook and API key.
7. Run two real inbound tests and two outbound tests: service-window free form, required template, media and button; verify sent/delivered/read in Kiara.
8. Switch the server-side provider flag to 360dialog.
9. Resume one designated staff member, then the team, then automations. Keep campaigns paused for 24 hours.
10. Monitor continuously for the first two hours and daily for seven days.

### Rollback rule

Before Meta transfers the number, rollback means keeping the Twilio flag active. After Meta transfers it, there is **no instant rollback**: restoring Twilio requires another migration/onboarding process. Do not promise a five-minute reversal. If the post-transfer smoke test fails, keep outbound automation paused, fix the 360dialog integration with priority support, and use the pre-agreed manual fallback channel for urgent customers.

## Final recommendation

Use **360dialog Regular** for normal operation. Premium can be justified for the migration month if the faster support SLA is worth the additional $60/€50, then downgraded after stability. Do not use Advanced at the current volume.

Proceed only when all three blockers are cleared: approved display name, working template strategy, and a tested integration. The same customer-facing features are achievable, and customers should keep the same WhatsApp number and thread, but the migration should be treated as a controlled production release—not an immediate delete-and-reconnect action.

## Sources

[^1]: 360dialog, [Migrate a number to 360dialog](https://docs.360dialog.com/docs/hub/migrations/migrate-a-number-to-360dialog) — migration flow, display-name approval and 2FA requirements.
[^2]: 360dialog, [Migrations](https://docs.360dialog.com/docs/hub/migrations) — transferred assets, excluded history, template `APPROVED` + `GREEN` requirement and re-review behavior.
[^3]: 360dialog, [Upload, retrieve or delete media](https://docs.360dialog.com/partner/messaging-and-calling/media-messages/upload-retrieve-delete-media) — media storage and five-minute retrieval URLs.
[^4]: 360dialog, [WhatsApp Business Platform pricing](https://360dialog.com/pricing) — Regular, Premium and Advanced plan inclusions and support SLAs.
[^5]: 360dialog, [WhatsApp cost per message](https://docs.360dialog.com/partner/messaging/sending-and-receiving-messages/conversations) — Meta rate cards, country/category rules and no 360dialog markup.
[^6]: 360dialog, [Month Closing Invoice](https://docs.360dialog.com/docs/hub/invoices/month-closing-invoice-mci) — credit reconciliation, saved payment method and 4% processing fee.
[^7]: 360dialog, [Service-message charging from October 2026](https://360dialog.com/blog/es/cobro-mensajes-servicio-whatsapp-octubre-2026/) — 1 October change, first 1,000 service messages free, Saudi service rate and 30 September payment-method deadline. The new Saudi Marketing rate of $0.0576 is taken from the Meta rate card linked by 360dialog; the calculator states that its rates update on 1 October.
[^8]: Twilio, [WhatsApp Messaging Pricing](https://www.twilio.com/en-us/whatsapp/pricing) — $0.005 per inbound or outbound message, plus Meta charges.
[^9]: 360dialog, [WhatsApp API Pricing Calculator](https://360dialog.com/pricing-calculator-whatsapp-api) — current Saudi Marketing `$0.0501`, Utility `$0.0107`, Service `$0`, and the $59 Regular plan.
[^10]: 360dialog, [Webhooks](https://docs.360dialog.com/docs/messaging/webhook) — JSON events, immediate asynchronous acknowledgement and five-second hard limit.
