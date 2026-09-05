import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planServiceChange,
  serviceFingerprint,
} from "../src/lib/service-change-planning.ts";
const base = {
  arrivalAt: "2026-09-05T17:00:00Z",
  durationMinutes: 60,
  serviceStartedAt: null,
  minutes: 30,
  now: "2026-09-05T17:20:00Z",
};
test("sequential addition extends by its duration", () => {
  const p = planServiceChange(base);
  assert.equal(p.newEnd, "2026-09-05T18:30:00.000Z");
  assert.equal(p.extensionMinutes, 30);
});
test("actual service start anchors timing when late", () => {
  const p = planServiceChange({
    ...base,
    serviceStartedAt: "2026-09-05T17:15:00Z",
  });
  assert.equal(p.newEnd, "2026-09-05T18:45:00.000Z");
});
test("addition after estimated finish starts now", () => {
  const p = planServiceChange({ ...base, now: "2026-09-05T18:10:00Z" });
  assert.equal(p.extensionMinutes, 40);
});
test("explicit gap included in driver waiting", () => {
  const p = planServiceChange({
    ...base,
    requestedStart: "2026-09-05T18:20:00Z",
  });
  assert.equal(p.extensionMinutes, 50);
});
test("edit applies only difference and reconciliation no extra time", () => {
  assert.equal(
    planServiceChange({ ...base, previousMinutes: 20 }).extensionMinutes,
    10,
  );
  assert.equal(
    planServiceChange({ ...base, previousMinutes: 30 }).extensionMinutes,
    0,
  );
});
test("cross midnight service remains a real elapsed duration", () => {
  const p = planServiceChange({ ...base, arrivalAt: "2026-09-05T20:30:00Z" });
  assert.equal(p.newEnd, "2026-09-05T22:00:00.000Z");
});
test("invalid and overlong durations refused", () => {
  for (const minutes of [0, -1, 1.5, NaN, 481])
    assert.throws(() => planServiceChange({ ...base, minutes }));
  assert.throws(() => planServiceChange({ ...base, durationMinutes: 470 }));
});
test("payment-only changes do not suggest new services", () => {
  assert.equal(
    serviceFingerprint({
      service: "A",
      durationMinutes: 30,
      payment: "Pending",
    }),
    serviceFingerprint({ service: "A", durationMinutes: 30, payment: "Paid" }),
  );
});

test("a rescheduled linked service carries its delay into the visit finish", () => {
  const p = planServiceChange({
    ...base,
    previousMinutes: 30,
    previousStartsAt: "2026-09-05T17:00:00Z",
    requestedStart: "2026-09-05T17:20:00Z",
  });
  assert.equal(p.extensionMinutes, 20);
});
