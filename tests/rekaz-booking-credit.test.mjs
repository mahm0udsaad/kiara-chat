import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, imports = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const require = (name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  };
  new Function("require", "module", "exports", code)(require, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const phone = load("src/lib/phone.ts");
const { creditRekazBookings, normalizeStaffName } = load("src/lib/rekaz-booking-credit.ts", {
  "@/lib/phone": phone,
});

const booking = (createdBy, amount = 100) => ({
  payload: { createdBy, bookedAt: "2026-10-05T10:00:00+03:00", amount, status: "Confirmed", customerPhone: "+966500000000" },
});
const window = { fromMs: Date.parse("2026-10-01T00:00:00Z"), toMs: Date.parse("2026-10-10T00:00:00Z") };

test("Rekaz's ه spelling credits the roster's ة name", () => {
  const credits = creditRekazBookings({
    reservations: [booking("رحمه", 300), booking("نسمه", 200), booking("نسمه", 50)],
    namesByMemberId: new Map([["rahma", "رحمة"], ["nesma", "نسمة"]]),
    firstReplyAt: new Map(),
    ...window,
  });
  assert.equal(credits.get("rahma")?.bookings, 1);
  assert.equal(credits.get("rahma")?.bookedRevenue, 300);
  assert.equal(credits.get("nesma")?.bookings, 2);
  assert.equal(credits.get("nesma")?.bookedRevenue, 250);
});

test("spelling variants fold to one name; decoration still goes", () => {
  assert.equal(normalizeStaffName("وفاء💞"), normalizeStaffName("وفاء"));
  assert.equal(normalizeStaffName("مــرام"), "مرام");
  assert.equal(normalizeStaffName("إيمان"), normalizeStaffName("ايمان"));
  assert.equal(normalizeStaffName("ليلى"), normalizeStaffName("ليلي"));
  assert.equal(normalizeStaffName("رَحْمَة"), normalizeStaffName("رحمه"));
  // Still exact, never by prefix: مرام and مرامي stay two people.
  assert.notEqual(normalizeStaffName("مرام"), normalizeStaffName("مرامي"));
});

test("two roster names that fold together are credited to nobody", () => {
  const credits = creditRekazBookings({
    reservations: [booking("رحمه")],
    namesByMemberId: new Map([["a", "رحمة"], ["b", "رحمه"]]),
    firstReplyAt: new Map(),
    ...window,
  });
  assert.equal(credits.size, 0);
});

test("a website booking (no createdBy) is nobody's", () => {
  const credits = creditRekazBookings({
    reservations: [booking("")],
    namesByMemberId: new Map([["rahma", "رحمة"]]),
    firstReplyAt: new Map(),
    ...window,
  });
  assert.equal(credits.size, 0);
});

const line = (createdBy, amount, order, extra = {}) => ({
  payload: {
    createdBy,
    bookedAt: "2026-10-05T10:00:00+03:00",
    amount,
    status: "Done",
    customerPhone: "+966500000000",
    order,
    ...extra,
  },
});
const credit = (reservations, names = [["nesma", "نسمة"], ["suad", "سعاد"]]) =>
  creditRekazBookings({ reservations, namesByMemberId: new Map(names), firstReplyAt: new Map(), ...window });

test("revenue is the order total, not the pre-VAT service line", () => {
  // نسمة's pedicure on 2026-10-19: a 145 line on a 165 order.
  const credits = credit([line("نسمه", 145, { id: "o1", total: 165, refunded: 0 })]);
  assert.equal(credits.get("nesma")?.bookedRevenue, 165);
});

test("an order with several services is counted once, split by line", () => {
  const order = { id: "o2", total: 249, refunded: 0 };
  const credits = credit([
    line("نسمه", 95.54, order),
    line("نسمه", 81.2, order),
    line("سعاد", 37.26, order),
  ]);
  assert.equal(credits.get("nesma")?.bookings, 1);
  assert.equal(credits.get("suad")?.bookings, 1);
  assert.equal(credits.get("nesma")?.bookedRevenue, 206);
  assert.equal(credits.get("suad")?.bookedRevenue, 43);
});

test("refunds come off, and a cancelled service takes no share", () => {
  const order = { id: "o3", total: 300, refunded: 100 };
  const credits = credit([
    line("نسمه", 150, order),
    line("نسمه", 150, order, { status: "Cancelled" }),
  ]);
  assert.equal(credits.get("nesma")?.bookings, 1);
  assert.equal(credits.get("nesma")?.bookedRevenue, 200);
});

test("rows without order data keep their line amount", () => {
  const credits = credit([
    line("نسمه", 120, null),
    line("نسمه", 80, { id: "o4", total: 0, refunded: 0 }),
  ]);
  assert.equal(credits.get("nesma")?.bookedRevenue, 200);
});

test("one booking per order, however many services (وفاء, 2026-10-20)", () => {
  const order = { id: "8bc25c", total: 449, refunded: 0 };
  const credits = creditRekazBookings({
    reservations: [150, 80, 145, 39].map((amount) => line("وفاء💞", amount, order))
      .concat([line("وفاء💞", 200, { id: "c3db1c", total: 200, refunded: 0 }), line("وفاء💞", 50, null), line("وفاء💞", 60, null)]),
    namesByMemberId: new Map([["wafa", "وفاء"]]),
    firstReplyAt: new Map([["wafa:500000000", "2026-10-05T06:00:00Z"]]),
    ...window,
  });
  assert.equal(credits.get("wafa")?.bookings, 4);
  assert.equal(credits.get("wafa")?.bookingsFromHerChats, 4);
  assert.equal(credits.get("wafa")?.bookedRevenue, 759);
});
