import { describe, expect, test } from "bun:test";

import {
  classifyPunctuality,
  coordinatesFromText,
  haversineRoute,
  shortMapLinkIn,
} from "../src/lib/punctuality-core.ts";

const minute = 60_000;
// Appointment at 90; the driver should reach the specialist by 60.
const base = {
  nowMs: 100 * minute,
  scheduledClientAtMs: 90 * minute,
  plannedSpecialistAtMs: 60 * minute,
  specialistAtMs: 60 * minute,
  pickupAtMs: 70 * minute,
  clientAtMs: 90 * minute,
  clientAtSource: "geofence",
  lastLocationAtMs: 90 * minute,
  graceMs: 5 * minute,
  pickupBufferMs: 10 * minute,
  staleAfterMs: 3 * minute,
};
const verdict = (overrides) => classifyPunctuality({ ...base, ...overrides });

describe("punctuality classification", () => {
  test("a visit reached within grace is on time", () => {
    expect(verdict({ clientAtMs: 95 * minute })).toEqual({
      classification: "on_time", certainty: "confirmed", uncertaintyCode: null,
    });
  });

  test("an early-stage slip absorbed on the road is not a late visit", () => {
    expect(verdict({ specialistAtMs: 75 * minute, pickupAtMs: 78 * minute, clientAtMs: 92 * minute }).classification)
      .toBe("on_time");
  });

  test("a late visit is attributed to the first stage that slipped", () => {
    expect(verdict({ specialistAtMs: 66 * minute, clientAtMs: 100 * minute }).classification)
      .toBe("driver_late_to_specialist");
    expect(verdict({ pickupAtMs: 76 * minute, clientAtMs: 100 * minute }).classification)
      .toBe("specialist_delayed_departure");
    expect(verdict({ clientAtMs: 96 * minute })).toEqual({
      classification: "driver_trip_late_to_client", certainty: "confirmed", uncertaintyCode: null,
    });
  });

  test("service start stands in for a missed client fence", () => {
    expect(verdict({ clientAtMs: 94 * minute, clientAtSource: "service_start" }).classification).toBe("on_time");
    // Late by service start cannot rule out the client keeping the team waiting.
    expect(verdict({ clientAtMs: 99 * minute, clientAtSource: "service_start" })).toEqual({
      classification: "driver_trip_late_to_client", certainty: "uncertain", uncertaintyCode: "missing_gps",
    });
  });

  test("before the deadline with no arrival the visit is still pending", () => {
    expect(verdict({ nowMs: 94 * minute, clientAtMs: null }).classification).toBe("pending");
  });

  test("past the deadline with no arrival evidence stays uncertain, with why", () => {
    expect(verdict({ clientAtMs: null, lastLocationAtMs: null }).uncertaintyCode).toBe("missing_gps");
    expect(verdict({ clientAtMs: null, lastLocationAtMs: 80 * minute }).uncertaintyCode).toBe("stale_gps");
    expect(verdict({ clientAtMs: null, lastLocationAtMs: 99 * minute }).uncertaintyCode).toBe("missing_milestone");
  });

  test("late with no specialist arrival or pickup cannot be attributed", () => {
    expect(verdict({ specialistAtMs: null, clientAtMs: 100 * minute }).classification).toBe("uncertain");
    expect(verdict({ pickupAtMs: null, clientAtMs: 100 * minute }).classification).toBe("uncertain");
  });
});

describe("map pins", () => {
  test("reads the link shapes the team actually pastes", () => {
    expect(coordinatesFromText("https://maps.google.com/?q=24.7136,46.6753")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(coordinatesFromText("منزل — https://www.google.com/maps/search/?api=1&query=17.44027068548488,44.1027284501238"))
      .toEqual({ lat: 17.44027068548488, lng: 44.1027284501238 });
    expect(coordinatesFromText("https://www.google.com/maps/place/x/@17.5,44.2,17z/data=!3d17.5123!4d44.2456"))
      .toEqual({ lat: 17.5123, lng: 44.2456 });
    expect(coordinatesFromText("17.5201, 44.2003")).toEqual({ lat: 17.5201, lng: 44.2003 });
  });

  test("does not invent coordinates from addresses or free text", () => {
    expect(coordinatesFromText("الرياض، بدون دبوس محفوظ")).toBeNull();
    expect(coordinatesFromText("حي ال حمد — NJJA7093، 7093 الشرفة 115، 2634، نجران 66245")).toBeNull();
    expect(() => coordinatesFromText("خصم 50% على الزيارة")).not.toThrow();
  });

  test("spots short links that need a redirect to resolve", () => {
    expect(shortMapLinkIn("https://maps.app.goo.gl/tXfPY12XjJxfFJTf8?g_st=ic"))
      .toBe("https://maps.app.goo.gl/tXfPY12XjJxfFJTf8");
    expect(shortMapLinkIn("https://goo.gl/maps/NqB1vcxQWqHWENsm6")).toBe("https://goo.gl/maps/NqB1vcxQWqHWENsm6");
    expect(shortMapLinkIn("https://maps.google.com/?q=1,2")).toBeNull();
  });

  test("the fallback route is marked and never zero", () => {
    const route = haversineRoute({ lat: 24.7136, lng: 46.6753 }, { lat: 24.72, lng: 46.68 });
    expect(route.source).toBe("haversine");
    expect(route.distanceMetres).toBeGreaterThan(0);
    expect(route.durationSeconds).toBeGreaterThanOrEqual(60);
  });
});
