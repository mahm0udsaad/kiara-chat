import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Load the report module's private outcome helpers with its imports stubbed.
const code = ts.transpileModule(readFileSync(new URL("../src/lib/customer-service-report.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText + "\nexports.__sheetOutcome = sheetOutcome; exports.__sheetConflicts = sheetConflicts;";
const loaded = { exports: {} };
// The report builds its formatters at load, so the time zone must be real.
const stub = new Proxy({}, { get: (_, key) => (key === "OPERATIONS_TIME_ZONE" ? "Asia/Riyadh" : () => ({})) });
new Function("require", "module", "exports", code)(() => stub, loaded, loaded.exports);
const { __sheetOutcome: sheetOutcome, __sheetConflicts: sheetConflicts } = loaded.exports;

const chat = (metadata) => ({ id: "c1", customer_phone: "+966530341010", metadata });

test("the outcome chosen in the sheet is the report's outcome", () => {
  assert.equal(sheetOutcome(chat({ contact_outcome: "booked" })), "booked");
  assert.equal(sheetOutcome(chat({ contact_outcome: "not_booked" })), "not_booked");
  assert.equal(sheetOutcome(chat({ contact_outcome: "no_reply", booking_stage: "collecting_details" })), "no_reply");
  assert.equal(sheetOutcome(chat({})), null);
});

test("a booked stage with no outcome reads booked", () => {
  for (const stage of ["booking_confirmed", "invoice_required", "in_progress", "completed"]) {
    assert.equal(sheetOutcome(chat({ booking_stage: stage })), "booked");
  }
  assert.equal(sheetOutcome(chat({ booking_stage: "awaiting_confirmation" })), null);
});

test("«لم ترد» + «تم التنفيذ» with no times to compare reads booked", () => {
  const row = chat({ contact_outcome: "no_reply", booking_stage: "completed" });
  assert.equal(sheetConflicts(row), true);
  assert.equal(sheetOutcome(row), "booked");
});

test("served after «لم ترد» reads booked (لينا, Sep)", () => {
  const row = chat({
    contact_outcome: "no_reply",
    contact_outcome_at: "2026-09-10T22:51:09Z",
    booking_stage: "completed",
    field_sessions: { o: { specialist: { completed_at: "2026-09-26T17:47:05Z" } } },
  });
  assert.equal(sheetOutcome(row), "booked");
});

test("«لم يتم الحجز» set after an earlier visit reads not booked (فله, Oct)", () => {
  const row = chat({
    contact_outcome: "not_booked",
    contact_outcome_at: "2026-10-11T18:37:20Z",
    booking_stage: "completed",
    field_sessions: { o: { driver: { started_at: "2026-09-30T10:00:00Z" }, specialist: { completed_at: "2026-09-30T13:39:38Z" } } },
  });
  assert.equal(sheetOutcome(row), "not_booked");
});

test("the stage's own event time counts when there is no visit", () => {
  const row = chat({ contact_outcome: "not_booked", contact_outcome_at: "2026-10-07T22:44:40Z", booking_stage: "completed" });
  assert.equal(sheetOutcome(row, Date.parse("2026-09-25T16:51:00Z")), "not_booked");
  assert.equal(sheetOutcome(row, Date.parse("2026-10-08T09:00:00Z")), "booked");
});

test("a Rekaz answer is reused only when it settles new or returning", () => {
  const final = loaded.exports.firstBookingAnswerIsFinal;
  const firstMessage = Date.parse("2026-10-20T10:00:00Z");
  // A found first booking never moves.
  assert.equal(final({ firstMs: Date.parse("2026-01-01"), checkedAt: 0 }, firstMessage), true);
  // "None" checked after her first message: anything later is after it too.
  assert.equal(final({ firstMs: null, checkedAt: Date.parse("2026-10-21") }, firstMessage), true);
  // "None" checked before her first message must be asked again.
  assert.equal(final({ firstMs: null, checkedAt: Date.parse("2026-10-19") }, firstMessage), false);
  assert.equal(final(undefined, firstMessage), false);
});
