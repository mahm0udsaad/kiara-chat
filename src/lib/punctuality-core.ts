export type PunctualityClassification =
  | "pending"
  | "on_time"
  | "driver_late_to_specialist"
  | "specialist_delayed_departure"
  | "driver_trip_late_to_client"
  | "uncertain";

export type SpecialistArrivalSource = "geofence" | "driver_step";
export type ClientArrivalSource = "geofence" | "service_start";

export type Point = { lat: number; lng: number };
export type RouteEstimate = {
  distanceMetres: number;
  durationSeconds: number;
  source: "osrm" | "haversine";
};

export function metresBetween(a: Point, b: Point): number {
  const radius = 6_371_000;
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radius * Math.asin(Math.sqrt(h)));
}

export function haversineRoute(a: Point, b: Point, speedKph = 28): RouteEstimate {
  const distanceMetres = Math.round(metresBetween(a, b) * 1.25);
  return {
    distanceMetres,
    durationSeconds: Math.max(60, Math.round(distanceMetres / (speedKph / 3.6))),
    source: "haversine",
  };
}

export function finitePoint(lat: unknown, lng: unknown): Point | null {
  if (lat === null || lat === undefined || lat === "" || lng === null || lng === undefined || lng === "") {
    return null;
  }
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 &&
    Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180
    ? point : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Free text such as "خصم 50%" is not a valid escape sequence.
    return value;
  }
}

/**
 * Coordinates from a pasted pin: Google Maps `?q=` / `query=` / `ll=` links,
 * `/@lat,lng` place links, `!3dlat!4dlng` data segments, or a bare "lat, lng".
 */
export function coordinatesFromText(value: string): Point | null {
  const decoded = safeDecode(value);
  const patterns = [
    /(?:query|q|ll|destination)=(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/i,
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    const point = match ? finitePoint(match[1], match[2]) : null;
    if (point) return point;
  }
  return null;
}

/** Short share links (maps.app.goo.gl, goo.gl/maps) that hide the pin behind a redirect. */
export function shortMapLinkIn(value: string): string | null {
  return value.match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[A-Za-z0-9_-]+/)?.[0] ?? null;
}

export function isLateClassification(value: string): boolean {
  return value === "driver_late_to_specialist" ||
    value === "specialist_delayed_departure" ||
    value === "driver_trip_late_to_client";
}

export type PunctualityAssessment = {
  classification: PunctualityClassification;
  certainty: "confirmed" | "uncertain";
  uncertaintyCode: string | null;
};

/**
 * A visit is judged by when the client was reached. Only a late arrival is
 * attributed to a stage; an early-stage slip that was absorbed on the road is
 * not a late visit and never asks anyone for a reason.
 *
 * The client arrival comes from the GPS geofence, or failing that from the
 * service-start tap. Service start is an upper bound: on time by it proves on
 * time, but late by it cannot rule out the client keeping the team waiting, so
 * that verdict stays uncertain.
 */
export function classifyPunctuality(input: {
  nowMs: number;
  scheduledClientAtMs: number;
  plannedSpecialistAtMs: number;
  specialistAtMs: number | null;
  pickupAtMs: number | null;
  clientAtMs: number | null;
  clientAtSource: ClientArrivalSource | null;
  lastLocationAtMs: number | null;
  graceMs: number;
  pickupBufferMs: number;
  staleAfterMs: number;
}): PunctualityAssessment {
  const deadline = input.scheduledClientAtMs + input.graceMs;
  if (input.clientAtMs === null) {
    if (input.nowMs <= deadline) {
      return { classification: "pending", certainty: "uncertain", uncertaintyCode: null };
    }
    return {
      classification: "uncertain",
      certainty: "uncertain",
      uncertaintyCode: input.lastLocationAtMs === null
        ? "missing_gps"
        : input.nowMs - input.lastLocationAtMs > input.staleAfterMs
          ? "stale_gps"
          : "missing_milestone",
    };
  }
  if (input.clientAtMs <= deadline) {
    return { classification: "on_time", certainty: "confirmed", uncertaintyCode: null };
  }
  if (input.specialistAtMs === null) {
    return { classification: "uncertain", certainty: "uncertain", uncertaintyCode: "missing_milestone" };
  }
  if (input.specialistAtMs > input.plannedSpecialistAtMs + input.graceMs) {
    return { classification: "driver_late_to_specialist", certainty: "confirmed", uncertaintyCode: null };
  }
  if (input.pickupAtMs === null) {
    return { classification: "uncertain", certainty: "uncertain", uncertaintyCode: "missing_milestone" };
  }
  if (input.pickupAtMs > input.specialistAtMs + input.pickupBufferMs + input.graceMs) {
    return { classification: "specialist_delayed_departure", certainty: "confirmed", uncertaintyCode: null };
  }
  return input.clientAtSource === "geofence"
    ? { classification: "driver_trip_late_to_client", certainty: "confirmed", uncertaintyCode: null }
    : { classification: "driver_trip_late_to_client", certainty: "uncertain", uncertaintyCode: "missing_gps" };
}
