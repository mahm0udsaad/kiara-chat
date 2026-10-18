import { describe, expect, test } from "bun:test";

import {
  driverTripSteps,
  SPECIALIST_LEAD_MINUTES,
  summarizeDriverSteps,
} from "../src/lib/driver-steps.ts";

const minute = 60_000;
const at = (minutes) => new Date(Date.UTC(2026, 9, 12, 12, 0) + minutes * minute).toISOString();
// Appointment at 0; with no plan the driver is due at the specialist at -30.
const trip = (overrides = {}) =>
  driverTripSteps({
    arrivalAt: at(0),
    plannedSpecialistAt: null,
    driverArrivedAt: at(-SPECIALIST_LEAD_MINUTES),
    driverClientArrivedAt: at(0),
    graceMinutes: 5,
    nowMs: Date.parse(at(120)),
    ...overrides,
  });

describe("driver arrival steps", () => {
  test("both steps confirmed at their due times are on time", () => {
    const steps = trip();
    expect(steps.specialist).toEqual({
      dueAt: at(-30), at: at(-30), status: "on_time", lateMinutes: null,
    });
    expect(steps.client.status).toBe("on_time");
    expect(steps.specialistDueBasis).toBe("lead");
  });

  test("at the client there is no grace: a minute past the booking is late", () => {
    expect(trip({ driverClientArrivedAt: at(1) }).client).toEqual({
      dueAt: at(0), at: at(1), status: "late", lateMinutes: 1,
    });
    // Seconds into the booking minute are still the booking minute.
    const withinMinute = new Date(Date.parse(at(0)) + 40_000).toISOString();
    expect(trip({ driverClientArrivedAt: withinMinute }).client.status).toBe("on_time");
  });

  test("at the specialist a confirmation within grace is still on time", () => {
    expect(trip({ driverArrivedAt: at(-25) }).specialist.status).toBe("on_time");
    expect(trip({ driverArrivedAt: at(-24) }).specialist).toMatchObject({ status: "late", lateMinutes: 6 });
  });

  test("late at the specialist is judged apart from the client", () => {
    const steps = trip({ driverArrivedAt: at(-8) });
    expect(steps.specialist).toMatchObject({ status: "late", lateMinutes: 22 });
    expect(steps.client.status).toBe("on_time");
  });

  test("a routed plan replaces the fixed lead", () => {
    const steps = trip({ plannedSpecialistAt: at(-50), driverArrivedAt: at(-30) });
    expect(steps.specialistDueBasis).toBe("plan");
    expect(steps.specialist).toMatchObject({ dueAt: at(-50), status: "late", lateMinutes: 20 });
  });

  test("a step never confirmed is missing once its time has passed", () => {
    expect(trip({ driverClientArrivedAt: null }).client).toEqual({
      dueAt: at(0), at: null, status: "missing", lateMinutes: null,
    });
  });

  test("a step that is not due yet is upcoming, not missing", () => {
    const steps = trip({
      driverArrivedAt: null,
      driverClientArrivedAt: null,
      nowMs: Date.parse(at(-60)),
    });
    expect(steps.specialist.status).toBe("upcoming");
    expect(steps.client.status).toBe("upcoming");
  });

  test("an unreadable appointment is not judged", () => {
    expect(trip({ arrivalAt: "not a date" })).toBeNull();
  });
});

describe("driver lateness summary", () => {
  test("counts each step on its own and reports the median delay", () => {
    const summary = summarizeDriverSteps([
      trip(),
      trip({ driverClientArrivedAt: at(10) }),
      trip({ driverClientArrivedAt: at(20) }),
      // Tapped the next morning: late, but it must not set the typical delay.
      trip({ driverClientArrivedAt: at(1_000) }),
      trip({ driverArrivedAt: at(0), driverClientArrivedAt: null }),
    ]);
    expect(summary.trips).toBe(5);
    expect(summary.client).toEqual({ onTime: 1, late: 3, missing: 1, medianLateMinutes: 20 });
    expect(summary.specialist).toEqual({ onTime: 4, late: 1, missing: 0, medianLateMinutes: 30 });
  });

  test("an even number of late steps takes the middle of the two", () => {
    const summary = summarizeDriverSteps([
      trip({ driverClientArrivedAt: at(10) }),
      trip({ driverClientArrivedAt: at(21) }),
    ]);
    expect(summary.client.medianLateMinutes).toBe(16);
  });

  test("no late steps leaves the median empty", () => {
    expect(summarizeDriverSteps([trip()]).client.medianLateMinutes).toBeNull();
  });
});
