import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// The «ملغاة» tile in the orders report opens a list of the cancelled orders:
// the customer, the appointment, who it went out to, and when (and by whom)
// it was cancelled.

const stubs = {
  "server-only": {},
  "@/lib/supabase/admin": { getAdminSupabaseClient: () => { throw new Error("no db in tests"); } },
  "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant" },
  "@/lib/paged-rows": { pageRowsByDay: async () => [], rowsByIdChunks: async () => [] },
  "@/lib/operations-report": { OPERATIONS_TIME_ZONE: "Asia/Riyadh", validateOperationsReportInput: (x) => x },
  "@/lib/service-timing": { serviceTimingOf: () => null },
};
const code = ts.transpileModule(
  readFileSync(new URL("../src/lib/orders-report.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function("module", "exports", "require", code)(loaded, loaded.exports, (name) => {
  if (name in stubs) return stubs[name];
  throw new Error(`unexpected import ${name}`);
});
const { buildCancelledOrders } = loaded.exports;

const lookups = (overrides = {}) => ({
  customerNames: new Map([["conv-1", "الهام محمد"]]),
  driverNames: new Map([["drv-1", "احمد"], ["drv-2", "طه"]]),
  specialistNames: new Map([["sp-1", "ايس"]]),
  teamNames: new Map([["tm-1", "منه"], ["tm-2", "رحمة"]]),
  appCancels: new Map(),
  rekazCancelledAt: new Map(),
  ...overrides,
});

const localOrder = (overrides = {}) => ({
  id: "order-1",
  conversation_id: "conv-1",
  customer_phone: "+966538856380",
  specialist_id: "sp-1",
  second_specialist_id: null,
  driver_id: "drv-1",
  return_driver_id: null,
  arrival_at: "2026-10-26T16:00:00+00:00",
  status: "cancelled",
  sent_at: "2026-10-26T14:38:53Z",
  updated_at: "2026-10-26T14:58:35Z",
  updated_by: "tm-1",
  rekaz_source_id: null,
  ...overrides,
});

const reservation = (overrides = {}) => ({
  source_id: "r-1",
  source_order_id: "o-1",
  arrival_at: "2026-10-25T13:00:00+00:00",
  status: "Cancelled",
  removed_at: null,
  payload: {
    customerName: "رحمه/الغويلا",
    customerPhone: "+966566416947",
    service: "مساج اخشاب",
    providers: ["ايس"],
  },
  ...overrides,
});

const group = (order, cancelledInApp) => ({
  cancelledInApp,
  order: {
    key: order.local ? `local:${order.local.id}` : "rekaz:o-1",
    day: "2026-10-26",
    reservationSourceIds: new Set((order.reservations ?? []).map((row) => row.source_id)),
    reservations: order.reservations ?? [],
    local: order.local ?? null,
  },
});

test("a team cancel names the person and time from its event", () => {
  const [row] = buildCancelledOrders(
    [group({ local: localOrder({ updated_by: "tm-2", updated_at: "2026-10-27T09:00:00Z" }) }, true)],
    lookups({
      appCancels: new Map([["order-1", { at: "2026-10-26T14:58:35Z", by: "team", teamMemberId: "tm-1" }]]),
    }),
  );
  assert.equal(row.cancelledIn, "app");
  // The event wins over a later edit that moved updated_at/updated_by.
  assert.equal(row.cancelledBy, "منه");
  assert.equal(row.cancelledAt, "2026-10-26T14:58:35Z");
  assert.equal(row.cancelledAtIsUpperBound, false);
  assert.deepEqual(row.sentTo, { drivers: ["احمد"], specialists: ["ايس"] });
  assert.equal(row.customerName, "الهام محمد");
  assert.equal(row.orderId, "order-1");
});

test("a driver cancel from the field app is the driver's, not the last editor's", () => {
  // The driver RPC stamps updated_at but not updated_by, so updated_by still
  // names whoever edited the order before.
  const [row] = buildCancelledOrders(
    [group({ local: localOrder({ driver_id: "drv-2", updated_by: "tm-2" }) }, true)],
    lookups({
      appCancels: new Map([["order-1", { at: "2026-10-25T13:49:05Z", by: "driver", teamMemberId: null }]]),
    }),
  );
  assert.equal(row.cancelledBy, "السائق طه");
  assert.equal(row.cancelledAt, "2026-10-25T13:49:05Z");
});

test("an older team cancel with no event falls back to the order's last update", () => {
  const [row] = buildCancelledOrders([group({ local: localOrder() }, true)], lookups());
  assert.equal(row.cancelledBy, "منه");
  assert.equal(row.cancelledAt, "2026-10-26T14:58:35Z");
});

test("an order cancelled before it was sent says nobody got it", () => {
  const [row] = buildCancelledOrders(
    [group({ local: localOrder({ sent_at: null, status: "cancelled" }) }, true)],
    lookups(),
  );
  assert.equal(row.sentTo, null);
});

test("a Rekaz cancel caught by the sync carries that time", () => {
  const [row] = buildCancelledOrders(
    [group({ reservations: [reservation()] }, false)],
    lookups({ rekazCancelledAt: new Map([["r-1", { at: "2026-10-24T08:00:00Z", upperBound: false }]]) }),
  );
  assert.equal(row.cancelledIn, "rekaz");
  assert.equal(row.cancelledAt, "2026-10-24T08:00:00Z");
  assert.equal(row.cancelledAtIsUpperBound, false);
  assert.equal(row.cancelledBy, null);
  assert.equal(row.orderId, null);
  assert.equal(row.customerName, "رحمه/الغويلا");
  assert.equal(row.customerPhone, "+966566416947");
  assert.deepEqual(row.services, ["مساج اخشاب"]);
  assert.equal(row.sentTo, null);
  assert.deepEqual(row.rekazProviders, ["ايس"]);
});

test("a booking first seen already cancelled is dated 'no later than'", () => {
  const [row] = buildCancelledOrders(
    [group({ reservations: [reservation()] }, false)],
    lookups({ rekazCancelledAt: new Map([["r-1", { at: "2026-10-20T23:02:05Z", upperBound: true }]]) }),
  );
  assert.equal(row.cancelledAt, "2026-10-20T23:02:05Z");
  assert.equal(row.cancelledAtIsUpperBound, true);
});

test("a removed booking uses its removal time; with nothing at all the time is unknown", () => {
  const [removed] = buildCancelledOrders(
    [group({ reservations: [reservation({ status: "Confirmed", removed_at: "2026-10-22T10:00:00Z" })] }, false)],
    lookups(),
  );
  assert.equal(removed.cancelledAt, "2026-10-22T10:00:00Z");
  const [unknown] = buildCancelledOrders([group({ reservations: [reservation()] }, false)], lookups());
  assert.equal(unknown.cancelledAt, null);
  assert.equal(unknown.cancelledAtIsUpperBound, false);
});

test("rows come back in appointment order", () => {
  const rows = buildCancelledOrders(
    [
      group({ local: localOrder({ id: "late", arrival_at: "2026-10-26T18:00:00Z" }) }, true),
      group({ local: localOrder({ id: "early", arrival_at: "2026-10-26T08:00:00Z" }) }, true),
    ].map((entry, index) => ({ ...entry, order: { ...entry.order, key: `k${index}` } })),
    lookups(),
  );
  assert.deepEqual(rows.map((row) => row.orderId), ["early", "late"]);
});

test("the cancel event now carries the actor_type the table requires", () => {
  const source = readFileSync(new URL("../src/lib/dispatch.ts", import.meta.url), "utf8");
  const cancel = source.slice(source.indexOf("export async function cancelDriverOrder"));
  const insert = cancel.slice(0, cancel.indexOf("withNames("));
  assert.match(insert, /event_type: "driver_order\.cancelled"/);
  assert.match(insert, /actor_type: command\.actor\.teamMemberId \? "team_member" : "owner"/);
});
