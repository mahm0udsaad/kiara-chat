import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// A «بدون طلب» card must open again, even when Rekaz marks the visit
// completed, so the coordinator can set its district (regression from the
// 6 Oct 2026 Rekaz-state gate). Driver dispatch keeps that gate.

function load(path, stubs = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  const require = (name) => {
    if (name in stubs) return stubs[name];
    throw new Error(`unexpected import ${name}`);
  };
  new Function("module", "exports", "require", code)(loaded, loaded.exports, require);
  return loaded.exports;
}

const gate = load("../src/lib/rekaz-visit-gate.ts");
const calendar = load("../apps/mobile/lib/calendar.ts", {
  "@/lib/phone": { phoneMatches: () => false },
});

test("only an explicit open intent relaxes the check; anything else is dispatch", () => {
  assert.equal(gate.parseReservationOrderIntent("open"), "open");
  assert.equal(gate.parseReservationOrderIntent("dispatch"), "dispatch");
  // Older builds send no intent at all and must keep today's refusals.
  assert.equal(gate.parseReservationOrderIntent(undefined), "dispatch");
  assert.equal(gate.parseReservationOrderIntent("OPEN"), "dispatch");
});

test("dispatch still refuses a completed or unconfirmed Rekaz visit", () => {
  assert.equal(gate.rekazDispatchRefusal(["Done"]), "RESERVATION_COMPLETED");
  assert.equal(gate.rekazDispatchRefusal(["Done", "Cancelled"]), "RESERVATION_COMPLETED");
  assert.equal(gate.rekazDispatchRefusal(["Pending", "Confirmed"]), "RESERVATION_NOT_CONFIRMED");
  assert.equal(gate.rekazDispatchRefusal(["Confirmed", "Done"]), null);
  assert.equal(gate.rekazDispatchRefusal(["Confirmed"]), null);
  assert.equal(gate.rekazDispatchRefusal([]), null);
  assert.equal(gate.rekazDispatchRefusal(["Cancelled"]), null);
});

test("raising an order to open a visit skips the Rekaz check; preview/send keep it", () => {
  const source = readFileSync(new URL("../src/lib/dispatch.ts", import.meta.url), "utf8");
  const raise = source.slice(source.indexOf("export async function createBookingFromReservation"));
  const raiseBody = raise.slice(0, raise.indexOf("\nexport ", 1));
  assert.match(
    raiseBody,
    /if \(intent === "dispatch"\) \{\s*await assertRekazVisitDispatchable\(/,
  );
  // The preview/send context still calls it with no intent in the way.
  const calls = source.match(/await assertRekazVisitDispatchable\(/g) ?? [];
  assert.equal(calls.length, 2);
  const route = readFileSync(
    new URL("../src/app/api/mobile/v1/orders/from-reservation/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /parseReservationOrderIntent\(body\.intent\)/);
});

const reservation = { id: "rekaz-1" };
const order = { id: "order-1" };

test("a completed «بدون طلب» booking opens (Monday 5 Oct cards)", () => {
  assert.equal(
    calendar.canOpenUnlinkedVisit({ order: null, reservation, rekazState: "completed" }),
    true,
  );
});

test("request and confirmed bookings without an order open too", () => {
  for (const rekazState of ["request", "confirmed", null]) {
    assert.equal(
      calendar.canOpenUnlinkedVisit({ order: null, reservation, rekazState }),
      true,
      String(rekazState),
    );
  }
});

test("a cancelled booking, or a card with nothing to raise from, stays shut", () => {
  assert.equal(
    calendar.canOpenUnlinkedVisit({ order: null, reservation, rekazState: "cancelled" }),
    false,
  );
  assert.equal(
    calendar.canOpenUnlinkedVisit({ order: null, reservation: null, rekazState: null }),
    false,
  );
});

test("a card that already has an order is not an unlinked visit", () => {
  assert.equal(
    calendar.canOpenUnlinkedVisit({ order, reservation, rekazState: "completed" }),
    false,
  );
});

test("the mobile hook sends the open intent for card taps", () => {
  const queries = readFileSync(new URL("../apps/mobile/lib/queries.ts", import.meta.url), "utf8");
  assert.match(queries, /typeof input === "string" \? \{ reservationId: input \} : input/);
  const list = readFileSync(
    new URL("../apps/mobile/app/(app)/(tabs)/orders/index.tsx", import.meta.url),
    "utf8",
  );
  assert.match(list, /\{ reservationId: visit\.reservation\.id, intent: "open" \}/);
  const grid = readFileSync(
    new URL("../apps/mobile/components/orders/schedule-grid.tsx", import.meta.url),
    "utf8",
  );
  assert.match(grid, /\{ reservationId: reservation\.id, intent: "open" \}/);
});
