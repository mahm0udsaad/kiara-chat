import { describe, expect, test } from "bun:test";

import {
  downsample,
  fixNear,
  plannedSpeedKph,
  tapDistanceFrom,
  trackStats,
  usableFixes,
} from "../src/lib/driver-tracking-core.ts";

const minute = 60_000;
const t0 = Date.parse("2026-10-06T08:00:00Z");
const at = (minutes) => new Date(t0 + minutes * minute).toISOString();
// ~111 m per 0.001° of latitude: a straight drive north.
const fix = (minutes, lat, extra = {}) => ({
  lat,
  lng: 44.15,
  at: at(minutes),
  accuracyMeters: 10,
  speedMps: 10,
  ...extra,
});

describe("usable fixes", () => {
  test("drops vague fixes and sorts by time", () => {
    const fixes = [fix(2, 17.002), fix(0, 17.0), fix(1, 17.001, { accuracyMeters: 180 })];
    expect(usableFixes(fixes).map((item) => item.at)).toEqual([at(0), at(2)]);
  });
});

describe("downsample", () => {
  test("keeps both ends and the requested count", () => {
    const items = Array.from({ length: 1_000 }, (_, index) => index);
    const out = downsample(items, 240);
    expect(out).toHaveLength(240);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(999);
  });

  test("leaves a short trail alone", () => {
    expect(downsample([1, 2, 3], 240)).toEqual([1, 2, 3]);
  });
});

describe("trip stats", () => {
  test("measures the driven distance and ignores GPS wander", () => {
    const fixes = [fix(0, 17.0), fix(1, 17.00002), fix(2, 17.001), fix(3, 17.002)];
    const stats = trackStats(fixes, { fromMs: t0, toMs: t0 + 3 * minute });
    // Two real 111 m legs; the 2 m wobble is inside the accuracy radius.
    expect(stats.distanceMetres).toBeGreaterThan(200);
    expect(stats.distanceMetres).toBeLessThan(240);
    expect(stats.coverage).toBe(1);
  });

  test("skips an impossible jump", () => {
    const fixes = [fix(0, 17.0), fix(0.1, 17.5), fix(1, 17.001)];
    expect(trackStats(fixes, { fromMs: null, toMs: null }).distanceMetres).toBeLessThan(200);
  });

  test("a silent stretch lowers coverage and shows as the longest gap", () => {
    const fixes = [fix(0, 17.0), fix(1, 17.001), fix(21, 17.01), fix(22, 17.011)];
    const stats = trackStats(fixes, { fromMs: t0, toMs: t0 + 22 * minute });
    expect(stats.longestGapSeconds).toBe(20 * 60);
    expect(stats.coverage).toBeLessThan(0.5);
  });

  test("a trip with no fixes has zero coverage, not an error", () => {
    expect(trackStats([], { fromMs: t0, toMs: t0 + 10 * minute })).toMatchObject({
      distanceMetres: 0,
      fixes: 0,
      coverage: 0,
    });
  });

  test("no window means no coverage figure", () => {
    expect(trackStats([fix(0, 17)], { fromMs: null, toMs: null }).coverage).toBeNull();
  });
});

describe("planned speed", () => {
  test("uses the driver's own recent moving speed", () => {
    const fixes = [0, 1, 2, 3].map((m) => fix(m, 17 + m / 1_000, { speedMps: 12.5 }));
    expect(plannedSpeedKph(fixes, t0 + 4 * minute, 28)).toEqual({ kph: 45, live: true });
  });

  test("clamps a crawl and falls back without enough readings", () => {
    const crawl = [0, 1, 2].map((m) => fix(m, 17, { speedMps: 2 }));
    expect(plannedSpeedKph(crawl, t0 + 3 * minute, 28)).toEqual({ kph: 18, live: true });
    expect(plannedSpeedKph([fix(0, 17)], t0, 28)).toEqual({ kph: 28, live: false });
  });

  test("ignores readings older than ten minutes", () => {
    const old = [0, 1, 2].map((m) => fix(m, 17, { speedMps: 15 }));
    expect(plannedSpeedKph(old, t0 + 30 * minute, 28).live).toBe(false);
  });
});

describe("tap evidence", () => {
  const fixes = [fix(0, 17.0), fix(10, 17.01)];

  test("finds the fix closest in time within the window", () => {
    expect(fixNear(fixes, t0 + 9 * minute)?.at).toBe(at(10));
    expect(fixNear(fixes, t0 + 5 * minute)).toBeNull();
  });

  test("measures how far the driver was from the place the tap claims", () => {
    const metres = tapDistanceFrom(fixes, at(10), { lat: 17.0, lng: 44.15 });
    expect(metres).toBeGreaterThan(1_000);
    expect(tapDistanceFrom(fixes, null, { lat: 17, lng: 44.15 })).toBeNull();
    expect(tapDistanceFrom(fixes, at(10), null)).toBeNull();
  });
});
