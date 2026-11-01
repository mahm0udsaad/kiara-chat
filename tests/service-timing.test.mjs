import { describe, expect, test } from "bun:test";

import {
  MAX_PLAUSIBLE_OVERRUN_MINUTES,
  SERVICE_TOLERANCE_MINUTES,
  serviceTimingOf,
  summarizeServiceTimings,
} from "../src/lib/service-timing.ts";

const minute = 60_000;
const at = (minutes) => new Date(Date.UTC(2026, 9, 12, 12, 0) + minutes * minute).toISOString();

describe("serviceTimingOf", () => {
  test("the clock starts at her start tap and runs for the summed services", () => {
    // Booked 12:00, two one-hour services, she taps start at 12:30: she has
    // until 14:30. Ending at 14:30 is on time although the visit began late.
    expect(serviceTimingOf(at(0), 60 + 60, at(150), at(30))).toEqual({
      bookedAt: at(0),
      startedAt: at(30),
      countedFrom: "start_tap",
      bookedMinutes: 120,
      expectedEndAt: at(150),
      completedAt: at(150),
      varianceMinutes: 0,
      verdict: "on_time",
    });
    // Ending at 14:45 overruns her two hours by 15 minutes.
    expect(serviceTimingOf(at(0), 120, at(165), at(30))).toMatchObject({
      varianceMinutes: 15,
      verdict: "late",
    });
    // Starting early does not hand her extra time: 11:50 + 2 h = 13:50.
    expect(serviceTimingOf(at(0), 120, at(125), at(-10))).toMatchObject({
      expectedEndAt: at(110),
      varianceMinutes: 15,
      verdict: "late",
    });
  });

  test("without a start tap the clock falls back to the booking time", () => {
    // Two services, 60 + 30 minutes, booked at 12:00: expected end 13:30.
    for (const startedAt of [undefined, null, "not a date"]) {
      expect(serviceTimingOf(at(0), 60 + 30, at(90), startedAt)).toMatchObject({
        startedAt: null,
        countedFrom: "booking",
        expectedEndAt: at(90),
        verdict: "on_time",
      });
    }
  });

  test("the expected end is the booking time plus the summed services when nothing else is known", () => {
    expect(serviceTimingOf(at(0), 60 + 30, at(90))).toEqual({
      bookedAt: at(0),
      startedAt: null,
      countedFrom: "booking",
      bookedMinutes: 90,
      expectedEndAt: at(90),
      completedAt: at(90),
      varianceMinutes: 0,
      verdict: "on_time",
    });
  });

  test("there is no tolerance: a full minute either side is late or early", () => {
    expect(SERVICE_TOLERANCE_MINUTES).toBe(0);
    expect(serviceTimingOf(at(0), 90, at(91))).toMatchObject({ varianceMinutes: 1, verdict: "late" });
    expect(serviceTimingOf(at(0), 90, at(89))).toMatchObject({ varianceMinutes: -1, verdict: "early" });
    // Seconds either side of the expected minute are still that minute.
    const seconds = (ms) => new Date(Date.parse(at(90)) + ms).toISOString();
    expect(serviceTimingOf(at(0), 90, seconds(40_000))?.verdict).toBe("on_time");
    expect(serviceTimingOf(at(0), 90, seconds(-40_000))?.verdict).toBe("on_time");
  });

  test("past the tolerance she finished late or early", () => {
    expect(serviceTimingOf(at(0), 90, at(120))).toMatchObject({ varianceMinutes: 30, verdict: "late" });
    expect(serviceTimingOf(at(0), 90, at(60))).toMatchObject({ varianceMinutes: -30, verdict: "early" });
  });

  test("an end tapped hours after the expected end is unreliable", () => {
    expect(serviceTimingOf(at(0), 90, at(90 + MAX_PLAUSIBLE_OVERRUN_MINUTES))?.verdict).toBe("late");
    expect(serviceTimingOf(at(0), 90, at(90 + MAX_PLAUSIBLE_OVERRUN_MINUTES + 1))?.verdict).toBe("unreliable");
  });

  test("nothing is judged without an end tap or a readable booking", () => {
    expect(serviceTimingOf(at(0), 90, null)).toBeNull();
    expect(serviceTimingOf("not a date", 90, at(90))).toBeNull();
  });
});

describe("summarizeServiceTimings", () => {
  test("counts each verdict and reports the median lateness", () => {
    const summary = summarizeServiceTimings([
      serviceTimingOf(at(0), 60, at(60)),
      serviceTimingOf(at(0), 60, at(80)),
      serviceTimingOf(at(0), 60, at(100)),
      serviceTimingOf(at(0), 60, at(30)),
      serviceTimingOf(at(0), 60, at(600)),
    ]);
    expect(summary).toEqual({
      timed: 5, onTime: 1, late: 2, early: 1, unreliable: 1, medianLateMinutes: 30,
    });
  });
});
