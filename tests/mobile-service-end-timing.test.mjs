import { describe, expect, test } from "bun:test";

import { serviceEndTimingOf, totalServiceMinutes } from "../apps/mobile/lib/service-timing.ts";

const minute = 60_000;
const at = (minutes) => new Date(Date.UTC(2026, 10, 1, 15, 0) + minutes * minute).toISOString();

describe("serviceEndTimingOf", () => {
  test("two one-hour services give her two hours from her start tap", () => {
    expect(serviceEndTimingOf(at(30), 120, at(150))).toEqual({
      startedAt: at(30),
      expectedEndAt: at(150),
      completedAt: at(150),
      durationMinutes: 120,
      minutes: 0,
      state: "on_time",
    });
    expect(serviceEndTimingOf(at(30), 120, at(165))).toMatchObject({ minutes: 15, state: "late" });
    expect(serviceEndTimingOf(at(30), 120, at(140))).toMatchObject({ minutes: 10, state: "early" });
  });

  test("before the finish tap the clock stays live", () => {
    expect(serviceEndTimingOf(at(0), 120, null, new Date(at(90)))).toMatchObject({ minutes: 30, state: "running" });
    expect(serviceEndTimingOf(at(0), 120, null, new Date(at(135)))).toMatchObject({ minutes: 15, state: "overdue" });
  });

  test("nothing to show before she starts or without a duration", () => {
    expect(serviceEndTimingOf(null, 120, null)).toBeNull();
    expect(serviceEndTimingOf(at(0), 0, null)).toBeNull();
  });
});

describe("totalServiceMinutes", () => {
  test("adds the services up, else falls back to the order's duration", () => {
    expect(totalServiceMinutes([{ minutes: 60 }, { minutes: 60 }], 10)).toBe(120);
    expect(totalServiceMinutes([], 90)).toBe(90);
    expect(totalServiceMinutes(undefined, 90)).toBe(90);
    expect(totalServiceMinutes([{ minutes: 0 }], 45)).toBe(45);
  });
});
