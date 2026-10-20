import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/rekaz-claim.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", code)(loaded, loaded.exports);
const { claimRelease } = loaded.exports;

// 2026-10-20 12:00 Riyadh.
const now = new Date("2026-10-20T09:00:00Z");

test("a sent order from an earlier day gives up a booking that moved", () => {
  // اميره/الفيصلية: the 4 October trip still held a booking moved to the 20th.
  assert.equal(claimRelease({ status: "sent", arrival_at: "2026-10-04T09:00:00+00:00" }, now), "past");
});

test("a sent order for today or later keeps its booking", () => {
  assert.equal(claimRelease({ status: "sent", arrival_at: "2026-10-20T05:00:00Z" }, now), null);
  assert.equal(claimRelease({ status: "sent", arrival_at: "2026-10-23T16:00:00Z" }, now), null);
});

test("the day boundary is Riyadh's, not UTC's", () => {
  // 23:30 Riyadh on the 19th is 20:30 UTC: yesterday, so past.
  assert.equal(claimRelease({ status: "sent", arrival_at: "2026-10-19T20:30:00Z" }, now), "past");
  // 00:30 Riyadh on the 20th is still the 19th in UTC: today, so kept.
  assert.equal(claimRelease({ status: "sent", arrival_at: "2026-10-19T21:30:00Z" }, now), null);
});

test("a pending order is never released, however old", () => {
  assert.equal(claimRelease({ status: "pending", arrival_at: "2026-10-03T12:00:00Z" }, now), null);
});

test("cancelled orders release either way", () => {
  assert.equal(claimRelease({ status: "cancelled", arrival_at: "2026-10-30T12:00:00Z" }, now), "cancelled");
  assert.equal(claimRelease({ status: "sent", dispatch_state: "cancelled", arrival_at: "2026-10-30T12:00:00Z" }, now), "cancelled");
});
