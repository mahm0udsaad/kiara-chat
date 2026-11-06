import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(
  readFileSync(new URL("../src/lib/customer-service-analysis-facts.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", code)(() => ({}), loaded, loaded.exports);
const { measureReplySpeed, speakerOf, verifyQuote, measureBookingOutcomes } = loaded.exports;

const HER = "her-id";
const OTHER = "other-id";
let n = 0;
const msg = (minute, role, extra = {}) => ({
  id: `m${n++}`,
  conversation_id: extra.conversation_id ?? "c1",
  role,
  sender_team_member_id: extra.sender ?? null,
  content: extra.content ?? "نص",
  message_type: "text",
  metadata: extra.metadata ?? null,
  created_at: new Date(Date.UTC(2026, 10, 1, 7, 0) + minute * 60_000).toISOString(),
});
const always = () => true;
const END = Date.UTC(2026, 10, 2);

test("bot, templates and broadcasts are never her", () => {
  assert.equal(speakerOf(msg(0, "agent", { sender: HER }), HER), "her");
  assert.equal(speakerOf(msg(0, "agent", { sender: OTHER }), HER), "colleague");
  assert.equal(speakerOf(msg(0, "agent", { metadata: { source: "bot" } }), HER), "bot");
  assert.equal(speakerOf(msg(0, "agent", { metadata: { source: "welcome" } }), HER), "automated");
  assert.equal(speakerOf(msg(0, "agent", { metadata: { broadcast: true } }), HER), "automated");
});

test("her wait runs from the first unanswered customer message, and the bot does not stop it", () => {
  const rows = [
    msg(0, "customer"),
    msg(2, "customer"),
    msg(5, "agent", { metadata: { source: "bot" } }),
    msg(45, "agent", { sender: HER }),
    msg(50, "customer"),
    msg(54, "agent", { sender: HER }),
  ];
  const speed = measureReplySpeed(rows, HER, always, END);
  assert.deepEqual(speed.waits, [45, 4]);
  assert.equal(speed.slowReplies, 1);
  assert.equal(speed.leftWaiting.length, 0);
});

test("a colleague's answer is not counted as her wait", () => {
  const rows = [msg(0, "customer"), msg(90, "agent", { sender: OTHER }), msg(95, "agent", { sender: HER })];
  assert.deepEqual(measureReplySpeed(rows, HER, always, END).waits, []);
});

test("waits that start outside the shift are not held against her", () => {
  const rows = [msg(0, "customer"), msg(120, "agent", { sender: HER })];
  assert.deepEqual(measureReplySpeed(rows, HER, () => false, END).waits, []);
});

test("left waiting: she answered last, the customer wrote again, nobody replied", () => {
  const rows = [msg(0, "customer"), msg(3, "agent", { sender: HER }), msg(10, "customer")];
  const speed = measureReplySpeed(rows, HER, always, END);
  assert.equal(speed.leftWaiting.length, 1);
  assert.equal(speed.leftWaiting[0].conversationId, "c1");
  // A colleague owning the chat last makes it not hers.
  const theirs = [...rows.slice(0, 2), msg(5, "agent", { sender: OTHER }), msg(10, "customer")];
  assert.equal(measureReplySpeed(theirs, HER, always, END).leftWaiting.length, 0);
  // Too fresh at the end of the period to count.
  const fresh = measureReplySpeed(rows, HER, always, Date.parse(rows[2].created_at) + 5 * 60_000);
  assert.equal(fresh.leftWaiting.length, 0);
});

test("quotes survive only if she wrote them in that chat", () => {
  const rows = [
    msg(0, "customer", { content: "كم سعر الحمام المغربي؟" }),
    msg(1, "agent", { sender: HER, content: "السعر ٢٥٠ ريال، تبين أحجز لك؟" }),
  ];
  assert.equal(verifyQuote("السعر ٢٥٠ ريال", rows, HER), "السعر ٢٥٠ ريال");
  assert.equal(verifyQuote("«السعر  ٢٥٠ ريال،»", rows, HER), "«السعر  ٢٥٠ ريال،»");
  assert.equal(verifyQuote("كم سعر الحمام المغربي", rows, HER), null, "customer's words are not hers");
  assert.equal(verifyQuote("السعر ٣٠٠ ريال", rows, HER), null);
  assert.equal(verifyQuote("", rows, HER), null);
});

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1, 9);
const chat = (id, phone, extra = {}) => ({
  conversationId: id,
  customerName: id,
  phone,
  firstReplyInPeriodMs: T0,
  firstReplyEverMs: T0,
  handledDays: 1,
  sheetOutcome: null,
  ...extra,
});
const booking = (phone, at, extra = {}) => ({
  phone,
  bookedAtMs: at,
  orderKey: `${phone}-${at}`,
  live: true,
  bookedBy: "her",
  ...extra,
});

test("a chat counts as booked only for a live booking after her reply, within the grace days", () => {
  const chats = [
    chat("a", "501"),
    chat("b", "502", { sheetOutcome: "no_reply" }),
    chat("c", "503", { sheetOutcome: "not_booked" }),
    chat("d", "504"),
    chat("e", "505"),
  ];
  const bookings = [
    booking("501", T0 + 3600_000, { bookedBy: "colleague" }),
    booking("502", T0 - 3600_000), // before her reply
    booking("503", T0 + DAY, { live: false }), // cancelled
    booking("504", T0 + 20 * DAY), // too late
    booking("505", T0 + 2 * DAY, { bookedBy: "online" }),
  ];
  const { conversion, bookedByConversation } = measureBookingOutcomes(chats, bookings, T0 + DAY, T0 + 60 * DAY);
  assert.equal(conversion.handled, 5);
  assert.equal(conversion.booked, 2);
  assert.equal(conversion.bookedByColleague, 1);
  assert.equal(conversion.bookedOnline, 1);
  assert.equal(conversion.notBooked, 3);
  assert.equal(conversion.cancelled, 1);
  assert.deepEqual(conversion.notBookedMarked, { notBooked: 1, noReply: 1, unmarked: 1 });
  assert.equal(conversion.rate, 40);
  assert.equal(bookedByConversation.get("c"), "cancelled");
  assert.equal(bookedByConversation.get("a"), "booked");
});

test("regular customers: handled on 2+ days and booked 2+ orders since her first reply", () => {
  const chats = [
    chat("loyal", "601", { handledDays: 3, firstReplyEverMs: T0 - 30 * DAY }),
    chat("once", "602", { handledDays: 1 }),
    chat("twice-one-booking", "603", { handledDays: 2, firstReplyEverMs: T0 - 30 * DAY }),
    chat("old-bookings", "604", { handledDays: 2, firstReplyEverMs: T0 }),
  ];
  const bookings = [
    booking("601", T0 - 20 * DAY),
    booking("601", T0 - 10 * DAY),
    booking("601", T0 - 10 * DAY, { orderKey: "601-" + (T0 - 10 * DAY) }), // same order, second service
    booking("602", T0 - 5 * DAY),
    booking("602", T0 + DAY),
    booking("603", T0 - 5 * DAY),
    booking("603", T0 - 4 * DAY, { live: false }),
    booking("604", T0 - 50 * DAY), // before she ever replied
    booking("604", T0 - 40 * DAY),
  ];
  const { retention } = measureBookingOutcomes(chats, bookings, T0 + DAY, T0 + 60 * DAY);
  assert.equal(retention.repeatHandled, 3, "the one-day customer is not counted");
  assert.equal(retention.repeatBookers, 1);
  assert.equal(retention.customers[0].conversationId, "loyal");
  assert.equal(retention.customers[0].bookings, 2, "one order is one booking");
  assert.equal(retention.rate, 33);
});
