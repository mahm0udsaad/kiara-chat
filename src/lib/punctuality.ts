import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { FieldStaffSession } from "@/lib/field-staff";
import {
  classifyPunctuality,
  coordinatesFromText,
  finitePoint,
  haversineRoute,
  isLateClassification,
  metresBetween,
  shortMapLinkIn,
  type ClientArrivalSource,
  type Point,
  type PunctualityClassification,
  type RouteEstimate,
  type SpecialistArrivalSource,
} from "@/lib/punctuality-core";
export type { PunctualityClassification } from "@/lib/punctuality-core";

export const LATE_REASON_CODES = [
  "traffic",
  "specialist_not_ready",
  "incorrect_specialist_location",
  "incorrect_client_location",
  "vehicle_issue",
  "previous_order_finished_late",
  "other",
] as const;
export type LateReasonCode = (typeof LATE_REASON_CODES)[number];

export type PunctualitySummary = {
  plannedSpecialistArrivalAt: string | null;
  plannedDriverDepartureAt: string | null;
  driverDepartedAt: string | null;
  specialistArrivedAt: string | null;
  specialistArrivalSource: SpecialistArrivalSource | null;
  specialistPickupAt: string | null;
  clientArrivedAt: string | null;
  clientArrivalSource: ClientArrivalSource | null;
  serviceStartedAt: string | null;
  specialistClientDistanceMetres: number | null;
  specialistClientDurationSeconds: number | null;
  driverStartDistanceMetres: number | null;
  driverStartDurationSeconds: number | null;
  routeSource: "osrm" | "haversine" | null;
  locationFreshnessSeconds: number | null;
  classification: PunctualityClassification;
  certainty: "confirmed" | "uncertain";
  uncertaintyCode: string | null;
  graceMinutes: number;
  geofenceMetres: number;
  pickupBufferMinutes: number;
  lateReasonCode: LateReasonCode | null;
  lateReasonNote: string | null;
  requiresLateReason: boolean;
  trackingActive: boolean;
};

type Row = Record<string, unknown>;

const DEFAULTS = {
  pickup_buffer_minutes: 10,
  grace_minutes: 5,
  geofence_metres: 125,
  stale_after_seconds: 180,
  fallback_speed_kph: 28,
  tracking_starts_at: null as string | null,
};
type Settings = typeof DEFAULTS;

/** Errors a driver's phone should treat as "stop tracking this order". */
export const TRACKING_STOP_CODES = ["TRIP_NOT_ACTIVE", "TRACKING_NOT_ENABLED"] as const;

const PROGRESS_COLS =
  "driver_confirmed_at, driver_arrived_at, specialist_pickup_at, service_started_at, completed_at";

async function routeBetween(a: Point, b: Point, speedKph: number): Promise<RouteEstimate> {
  const base = process.env.OSRM_BASE_URL?.replace(/\/$/, "");
  if (!base) return haversineRoute(a, b, speedKph);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(
      `${base}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&steps=false`,
      { signal: controller.signal, headers: { Accept: "application/json" } },
    );
    const payload = (await response.json()) as {
      code?: string;
      routes?: { distance?: number; duration?: number }[];
    };
    const route = payload.routes?.[0];
    if (!response.ok || payload.code !== "Ok" || !route) throw new Error("OSRM_ROUTE_FAILED");
    const distanceMetres = Math.round(Number(route.distance));
    const durationSeconds = Math.round(Number(route.duration));
    if (!Number.isFinite(distanceMetres) || !Number.isFinite(durationSeconds)) {
      throw new Error("OSRM_ROUTE_INVALID");
    }
    return { distanceMetres, durationSeconds, source: "osrm" };
  } catch {
    return haversineRoute(a, b, speedKph);
  } finally {
    clearTimeout(timer);
  }
}

/** Follows one redirect of a Google Maps short link to read the pin it hides. */
async function resolveShortMapLink(url: string): Promise<Point | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(url, { redirect: "manual", signal: controller.signal });
    const location = response.headers.get("location");
    return location ? coordinatesFromText(location) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A pasted pin (full link, short link or "lat, lng") as coordinates, or null. */
export async function pointFromMapText(value: string): Promise<Point | null> {
  const direct = coordinatesFromText(value);
  if (direct) return direct;
  const short = shortMapLinkIn(value);
  return short ? resolveShortMapLink(short) : null;
}

async function clientPointOf(customerLocation: string, rekazLocation: unknown): Promise<Point | null> {
  if (rekazLocation && typeof rekazLocation === "object") {
    const loc = rekazLocation as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown };
    const point = finitePoint(loc.lat ?? loc.latitude, loc.lng ?? loc.longitude);
    if (point) return point;
  } else if (typeof rekazLocation === "string") {
    const point = coordinatesFromText(rekazLocation);
    if (point) return point;
  }
  return pointFromMapText(customerLocation);
}

async function settings(): Promise<Settings> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("punctuality_settings")
    .select("*")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  return { ...DEFAULTS, ...((data ?? {}) as Partial<Settings>) };
}

async function loadPlan(orderId: string): Promise<Row | null> {
  const { data } = await getAdminSupabaseClient()
    .from("order_punctuality")
    .select("*")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("order_id", orderId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/**
 * The plan for one order, created or recalculated as needed.
 *
 * Only orders created at or after `tracking_starts_at` are ever planned, so
 * visits that were already running when the feature shipped are left alone.
 * Until the specialist is picked up, a change to the appointment time, the
 * client pin or the specialist recalculates the plan; after pickup it is
 * frozen, because the evidence is being measured against it.
 */
async function ensurePlan(orderId: string, config: Settings): Promise<Row | null> {
  const admin = getAdminSupabaseClient();
  const [existing, orderResult, progressResult] = await Promise.all([
    loadPlan(orderId),
    admin
      .from("driver_orders")
      .select("id, arrival_at, customer_location, specialist_id, rekaz_source_id, status, created_at")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("id", orderId)
      .maybeSingle(),
    admin
      .from("field_order_progress")
      .select("specialist_pickup_at")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("order_id", orderId)
      .maybeSingle(),
  ]);
  const order = orderResult.data as Row | null;
  if (!order) return existing;
  if (existing && (progressResult.data?.specialist_pickup_at || order.status === "cancelled")) {
    return existing;
  }
  if (!existing) {
    const startsAt = config.tracking_starts_at ? Date.parse(config.tracking_starts_at) : NaN;
    const createdAt = Date.parse(String(order.created_at));
    if (!Number.isFinite(startsAt) || !(createdAt >= startsAt)) return null;
    if (order.status === "cancelled" || !order.specialist_id) return null;
  }

  const { data: specialist } = await admin
    .from("specialists")
    .select("pickup_latitude, pickup_longitude")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("id", String(order.specialist_id))
    .maybeSingle();
  const signature = [
    order.arrival_at,
    order.specialist_id,
    order.customer_location,
    specialist?.pickup_latitude,
    specialist?.pickup_longitude,
  ].join("|");
  if (existing && existing.plan_signature === signature) return existing;

  const specialistPoint = finitePoint(specialist?.pickup_latitude, specialist?.pickup_longitude);
  let rekazLocation: unknown = null;
  if (order.rekaz_source_id) {
    const { data } = await admin
      .from("rekaz_reservations")
      .select("payload")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("source_id", String(order.rekaz_source_id))
      .maybeSingle();
    rekazLocation = (data?.payload as { location?: unknown } | null)?.location ?? null;
  }
  const clientPoint = await clientPointOf(String(order.customer_location ?? ""), rekazLocation);
  if (!specialistPoint || !clientPoint) return existing;

  const route = await routeBetween(specialistPoint, clientPoint, Number(config.fallback_speed_kph));
  const plannedSpecialistMs = Date.parse(String(order.arrival_at)) -
    (route.durationSeconds + Number(config.pickup_buffer_minutes) * 60) * 1_000;
  const planned = {
    specialist_latitude: specialistPoint.lat,
    specialist_longitude: specialistPoint.lng,
    client_latitude: clientPoint.lat,
    client_longitude: clientPoint.lng,
    specialist_client_distance_metres: route.distanceMetres,
    specialist_client_duration_seconds: route.durationSeconds,
    route_source: route.source,
    route_calculated_at: new Date().toISOString(),
    planned_specialist_arrival_at: new Date(plannedSpecialistMs).toISOString(),
    plan_signature: signature,
  };

  if (existing) {
    const startSeconds = existing.driver_start_route_duration_seconds;
    const { data, error } = await admin
      .from("order_punctuality")
      .update({
        ...planned,
        planned_driver_departure_at: startSeconds == null
          ? null
          : new Date(plannedSpecialistMs - Number(startSeconds) * 1_000).toISOString(),
      })
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("order_id", orderId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Row;
  }

  const { data, error } = await admin
    .from("order_punctuality")
    .upsert(
      { order_id: orderId, restaurant_id: KIARA_RESTAURANT_ID, ...planned },
      { onConflict: "order_id", ignoreDuplicates: true },
    )
    .select("*");
  if (error) throw new Error(error.message);
  // A concurrent request may have inserted first; its row is just as good.
  return ((data as Row[] | null)?.[0]) ?? (await loadPlan(orderId));
}

function evidenceOf(plan: Row, progress: Row | null) {
  const specialistArrivedAt = (plan.specialist_geofence_at ?? progress?.driver_arrived_at ?? null) as string | null;
  const specialistArrivalSource: SpecialistArrivalSource | null = plan.specialist_geofence_at
    ? "geofence"
    : progress?.driver_arrived_at ? "driver_step" : null;
  const clientArrivedAt = (plan.client_geofence_at ?? progress?.service_started_at ?? null) as string | null;
  const clientArrivalSource: ClientArrivalSource | null = plan.client_geofence_at
    ? "geofence"
    : progress?.service_started_at ? "service_start" : null;
  return { specialistArrivedAt, specialistArrivalSource, clientArrivedAt, clientArrivalSource };
}

/** Recomputes the verdict and writes it only when something changed. */
async function refreshClassification(
  plan: Row,
  progress: Row | null,
  order: { arrival_at: string; status: string },
  config: Settings,
): Promise<Row> {
  if (order.status === "cancelled") return plan;
  const evidence = evidenceOf(plan, progress);
  const at = (value: unknown) => (value ? Date.parse(String(value)) : null);
  const assessment = classifyPunctuality({
    nowMs: Date.now(),
    scheduledClientAtMs: Date.parse(order.arrival_at),
    plannedSpecialistAtMs: Date.parse(String(plan.planned_specialist_arrival_at)),
    specialistAtMs: at(evidence.specialistArrivedAt),
    pickupAtMs: at(progress?.specialist_pickup_at),
    clientAtMs: at(evidence.clientArrivedAt),
    clientAtSource: evidence.clientArrivalSource,
    lastLocationAtMs: at(plan.last_location_at),
    graceMs: Number(config.grace_minutes) * 60_000,
    pickupBufferMs: Number(config.pickup_buffer_minutes) * 60_000,
    staleAfterMs: Number(config.stale_after_seconds) * 1_000,
  });
  const next = {
    classification: assessment.classification,
    certainty: assessment.certainty,
    uncertainty_code: assessment.uncertaintyCode,
    specialist_arrival_source: evidence.specialistArrivalSource,
    client_arrival_source: evidence.clientArrivalSource,
  };
  const unchanged = (Object.keys(next) as (keyof typeof next)[])
    .every((key) => (plan[key] ?? null) === next[key]);
  if (unchanged) return plan;
  const { data, error } = await getAdminSupabaseClient()
    .from("order_punctuality")
    .update(next)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("order_id", String(plan.order_id))
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Row;
}

async function orderAndProgress(orderId: string) {
  const admin = getAdminSupabaseClient();
  const [orderResult, progressResult] = await Promise.all([
    admin
      .from("driver_orders")
      .select("driver_id, arrival_at, status")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("id", orderId)
      .maybeSingle(),
    admin
      .from("field_order_progress")
      .select(PROGRESS_COLS)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("order_id", orderId)
      .maybeSingle(),
  ]);
  return {
    order: orderResult.data as { driver_id: string | null; arrival_at: string; status: string } | null,
    progress: (progressResult.data as Row | null) ?? null,
  };
}

function trackingActive(plan: Row, progress: Row | null, status: string): boolean {
  return status === "sent" &&
    Boolean(progress?.driver_confirmed_at) &&
    !progress?.service_started_at &&
    !progress?.completed_at &&
    !plan.client_geofence_at;
}

export async function recordDriverLocation(
  session: FieldStaffSession,
  orderId: string,
  sample: { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string; speedMps?: number },
): Promise<PunctualitySummary> {
  if (session.role !== "driver") throw new Error("DRIVER_REQUIRED");
  const point = finitePoint(sample.latitude, sample.longitude);
  const accuracy = Number(sample.accuracyMeters);
  const capturedMs = Date.parse(sample.capturedAt);
  if (!point || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 250 ||
      !Number.isFinite(capturedMs) || Math.abs(Date.now() - capturedMs) > 15 * 60_000) {
    throw new Error("LOCATION_SAMPLE_INVALID");
  }
  const admin = getAdminSupabaseClient();
  const [{ order, progress }, config] = await Promise.all([orderAndProgress(orderId), settings()]);
  if (!order || order.driver_id !== session.rosterId) throw new Error("FIELD_ORDER_FORBIDDEN");
  const plan = await ensurePlan(orderId, config);
  if (!plan) throw new Error("TRACKING_NOT_ENABLED");
  if (!trackingActive(plan, progress, order.status)) throw new Error("TRIP_NOT_ACTIVE");

  const { error: insertError } = await admin.from("driver_trip_locations").insert({
    restaurant_id: KIARA_RESTAURANT_ID,
    order_id: orderId,
    field_staff_account_id: session.accountId,
    latitude: point.lat,
    longitude: point.lng,
    accuracy_meters: accuracy,
    speed_mps: sample.speedMps == null || !Number.isFinite(sample.speedMps)
      ? null
      : Math.max(0, Math.min(100, Number(sample.speedMps))),
    captured_at: new Date(capturedMs).toISOString(),
  });
  if (insertError) throw new Error(insertError.message);

  const capturedIso = new Date(capturedMs).toISOString();
  const specialist = { lat: Number(plan.specialist_latitude), lng: Number(plan.specialist_longitude) };
  const client = { lat: Number(plan.client_latitude), lng: Number(plan.client_longitude) };
  const geofence = Number(config.geofence_metres);
  // A fix vaguer than the fence itself cannot prove the driver was inside it.
  const preciseEnough = accuracy <= geofence;
  const patch: Row = {
    last_location_at: capturedIso,
    last_location_received_at: new Date().toISOString(),
  };
  if (plan.driver_start_latitude == null) {
    const startRoute = await routeBetween(point, specialist, Number(config.fallback_speed_kph));
    patch.driver_start_latitude = point.lat;
    patch.driver_start_longitude = point.lng;
    patch.driver_start_route_distance_metres = startRoute.distanceMetres;
    patch.driver_start_route_duration_seconds = startRoute.durationSeconds;
    patch.driver_start_route_source = startRoute.source;
    patch.planned_driver_departure_at = new Date(
      Date.parse(String(plan.planned_specialist_arrival_at)) - startRoute.durationSeconds * 1_000,
    ).toISOString();
  } else if (!plan.driver_departed_at && metresBetween(
    { lat: Number(plan.driver_start_latitude), lng: Number(plan.driver_start_longitude) }, point,
  ) >= 75) {
    patch.driver_departed_at = capturedIso;
  }
  if (preciseEnough && !plan.specialist_geofence_at && !progress?.specialist_pickup_at &&
      metresBetween(point, specialist) <= geofence) {
    patch.specialist_geofence_at = capturedIso;
  }
  if (preciseEnough && progress?.specialist_pickup_at && !plan.client_geofence_at &&
      metresBetween(point, client) <= geofence) {
    patch.client_geofence_at = capturedIso;
  }
  const updated = await admin
    .from("order_punctuality")
    .update(patch)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("order_id", orderId)
    .select("*")
    .single();
  if (updated.error || !updated.data) throw new Error(updated.error?.message ?? "PUNCTUALITY_UPDATE_FAILED");
  const current = await refreshClassification(updated.data as Row, progress, order, config);
  return summaryOf(current, progress, config, order.status);
}

function summaryOf(plan: Row, progress: Row | null, config: Settings, status: string): PunctualitySummary {
  const last = plan.last_location_at ? Date.parse(String(plan.last_location_at)) : null;
  const classification = String(plan.classification) as PunctualityClassification;
  const text = (value: unknown) => (value == null || value === "" ? null : String(value));
  const count = (value: unknown) => (value == null ? null : Number(value));
  const evidence = evidenceOf(plan, progress);
  return {
    plannedSpecialistArrivalAt: text(plan.planned_specialist_arrival_at),
    plannedDriverDepartureAt: text(plan.planned_driver_departure_at),
    driverDepartedAt: text(plan.driver_departed_at),
    specialistArrivedAt: evidence.specialistArrivedAt,
    specialistArrivalSource: evidence.specialistArrivalSource,
    specialistPickupAt: text(progress?.specialist_pickup_at),
    clientArrivedAt: evidence.clientArrivedAt,
    clientArrivalSource: evidence.clientArrivalSource,
    serviceStartedAt: text(progress?.service_started_at),
    specialistClientDistanceMetres: count(plan.specialist_client_distance_metres),
    specialistClientDurationSeconds: count(plan.specialist_client_duration_seconds),
    driverStartDistanceMetres: count(plan.driver_start_route_distance_metres),
    driverStartDurationSeconds: count(plan.driver_start_route_duration_seconds),
    routeSource: (plan.route_source as "osrm" | "haversine" | null) ?? null,
    locationFreshnessSeconds: last === null ? null : Math.max(0, Math.round((Date.now() - last) / 1_000)),
    classification,
    certainty: String(plan.certainty) as "confirmed" | "uncertain",
    uncertaintyCode: text(plan.uncertainty_code),
    graceMinutes: Number(config.grace_minutes),
    geofenceMetres: Number(config.geofence_metres),
    pickupBufferMinutes: Number(config.pickup_buffer_minutes),
    lateReasonCode: (plan.late_reason_code as LateReasonCode | null) ?? null,
    lateReasonNote: text(plan.late_reason_note),
    requiresLateReason: isLateClassification(classification) && !plan.late_reason_code,
    trackingActive: trackingActive(plan, progress, status),
  };
}

/**
 * The punctuality summary for one order, or null when the order is not
 * tracked (created before tracking started, or missing a pin).
 */
export async function getOrderPunctuality(orderId: string): Promise<PunctualitySummary | null> {
  const [{ order, progress }, config] = await Promise.all([orderAndProgress(orderId), settings()]);
  if (!order) return null;
  const plan = await ensurePlan(orderId, config);
  if (!plan) return null;
  const current = await refreshClassification(plan, progress, order, config);
  return summaryOf(current, progress, config, order.status);
}

export async function submitLateReason(input: {
  orderId: string;
  actorUserId: string;
  code: LateReasonCode;
  note: string;
}) {
  if (!LATE_REASON_CODES.includes(input.code) || input.note.trim().length < 3 || input.note.trim().length > 500) {
    throw new Error("LATE_REASON_INVALID");
  }
  const current = await getOrderPunctuality(input.orderId);
  if (!current || !isLateClassification(current.classification)) throw new Error("ORDER_NOT_LATE");
  const { error } = await getAdminSupabaseClient().from("order_punctuality").update({
    late_reason_code: input.code,
    late_reason_note: input.note.trim(),
    reason_submitted_by: input.actorUserId,
    reason_submitted_at: new Date().toISOString(),
  }).eq("restaurant_id", KIARA_RESTAURANT_ID).eq("order_id", input.orderId);
  if (error) throw new Error(error.message);
  return getOrderPunctuality(input.orderId);
}
