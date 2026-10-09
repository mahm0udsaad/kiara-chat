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
