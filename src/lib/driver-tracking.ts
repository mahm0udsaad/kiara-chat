import "server-only";

import {
  downsample,
  plannedSpeedKph,
  tapDistanceFrom,
  trackStats,
  usableFixes,
  type TrackFix,
  type TrackStats,
} from "@/lib/driver-tracking-core";
import type { FieldStaffSession } from "@/lib/field-staff";
import { driverCanReceivePush, notifyDriverLocationRequest } from "@/lib/field-push";
import { finitePoint, metresBetween, type Point } from "@/lib/punctuality-core";
import {
  clientPointOf,
  getOrderPunctuality,
  loadPlan,
  orderAndProgress,
  routeBetween,
  settings,
  trackingActive,
  tripTrackingEnabled,
  type PunctualitySummary,
} from "@/lib/punctuality";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

/**
 * Driver GPS as customer service sees it on one order: who the driver is and
 * whether their phone lets us track, the trail so far, when they should reach
 * the next stop, and where each step was tapped compared with where the trail
 * says they were.
 *
 * Read-only and best-effort. Every part degrades to "unknown" on its own — a
 * missing table, an unreachable route service or a phone that never reported —
 * so this section can never take the order screen down with it.
 */

export const LOCATION_PERMISSIONS = [
  "granted",
  "denied",
  "blocked",
  "undetermined",
  "unavailable",
] as const;
export type LocationPermission = (typeof LOCATION_PERMISSIONS)[number];

export type DriverLocationStatus = {
  permission: LocationPermission;
  servicesEnabled: boolean | null;
  backgroundCapable: boolean | null;
  platform: string | null;
  appVersion: string | null;
  reportedAt: string;
};

export type TrackingPointOut = { lat: number; lng: number; at: string };

export type TrackingMilestoneKey =
  | "confirmed"
  | "departed"
  | "specialist_arrived"
  | "pickup"
  | "client_arrived"
  | "service_started";

export type TrackingMilestone = {
  key: TrackingMilestoneKey;
  at: string | null;
  /** gps: a geofence or the trail proved it. tap: only the step button says so. */
  source: "gps" | "tap" | null;
  plannedAt: string | null;
  /** For taps: metres between the nearest fix and where the tap claims the driver was. */
  tapDistanceMetres: number | null;
};

export type TrackingFlag =
  | { code: "tap_far_from_specialist"; metres: number }
  | { code: "tap_far_from_client"; metres: number }
  | { code: "gps_gap"; minutes: number }
  | { code: "stale"; minutes: number }
  | { code: "no_fixes" }
  | { code: "expected_late"; minutes: number; target: "specialist" | "client" };

export type ClientEta = {
  at: string;
  remainingSeconds: number;
  /** Road distance still to drive, through the specialist when she is not in the car yet. */
  distanceMetres: number;
  scheduledAt: string;
  lateByMinutes: number;
  stage: "to_specialist" | "waiting_specialist" | "to_client";
  /** Heading to a specialist whose pickup pin is not saved: her leg is guessed. */
  approximate: boolean;
  source: "live_speed" | "osrm" | "estimate";
};

export type OrderTracking = {
  enabled: boolean;
  disabledReason: "switched_off" | "order_before_tracking" | null;
  driver: {
    id: string;
    name: string | null;
    status: DriverLocationStatus | null;
    canReceivePush: boolean;
    lastRequestAt: string | null;
  } | null;
  trip: {
    state: "not_started" | "active" | "finished" | "cancelled";
    startedAt: string | null;
    endedAt: string | null;
  };
  points: TrackingPointOut[];
  latest: (TrackingPointOut & {
    accuracyMeters: number;
    speedKph: number | null;
    freshnessSeconds: number;
  }) | null;
  places: { start: Point | null; specialist: Point | null; client: Point | null };
  eta: {
    target: "specialist" | "client";
    at: string;
    remainingSeconds: number;
    distanceMetres: number;
    source: "live_speed" | "osrm" | "estimate";
    scheduledAt: string | null;
    lateByMinutes: number | null;
  } | null;
  /**
   * When the driver should reach the client, whatever stop is next: before
   * pickup it runs through the specialist (drive there, her few minutes to
   * come down, then on to the client). Separate from `eta`, which the apps
   * already in drivers' hands read as "the next stop".
   */
  clientEta: ClientEta | null;
  stats: TrackStats;
  milestones: TrackingMilestone[];
  flags: TrackingFlag[];
  punctuality: PunctualitySummary | null;
};

type Row = Record<string, unknown>;

/** Points sent to the phone; enough for a smooth line, small enough for 3G. */
const MAX_PATH_POINTS = 240;
/** A tap this far from the trail's position at that moment is worth a look. */
const TAP_DISTANCE_FLAG_METRES = 400;
/** No fix for this long during a live trip reads as "GPS stopped". */
const STALE_FLAG_SECONDS = 5 * 60;

const text = (value: unknown) => (value == null || value === "" ? null : String(value));
const msOf = (value: unknown) => (value ? Date.parse(String(value)) : null);

async function driverAccounts(driverId: string): Promise<string[]> {
  const { data } = await getAdminSupabaseClient()
    .from("field_staff_accounts")
    .select("id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("role", "driver")
    .eq("driver_id", driverId)
    .eq("is_active", true);
  return (data ?? []).map((row) => row.id as string);
}

/**
 * The freshest status any of the driver's phones reported, or null when none
 * has (including before the table's migration lands).
 */
export async function getDriverLocationStatus(driverId: string): Promise<DriverLocationStatus | null> {
  const accounts = await driverAccounts(driverId);
  if (!accounts.length) return null;
  const { data, error } = await getAdminSupabaseClient()
    .from("field_staff_location_status")
    .select("permission, services_enabled, background_capable, platform, app_version, reported_at")
    .in("field_staff_account_id", accounts)
    .order("reported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    permission: data.permission as LocationPermission,
    servicesEnabled: (data.services_enabled as boolean | null) ?? null,
    backgroundCapable: (data.background_capable as boolean | null) ?? null,
    platform: text(data.platform),
    appVersion: text(data.app_version),
    reportedAt: String(data.reported_at),
  };
}

/** What a field phone says about its own location access. Never throws. */
export async function saveLocationStatus(
  session: FieldStaffSession,
  input: {
    permission: LocationPermission;
    servicesEnabled: boolean | null;
    backgroundCapable: boolean | null;
    platform: string | null;
    appVersion: string | null;
  },
): Promise<boolean> {
  const { error } = await getAdminSupabaseClient()
    .from("field_staff_location_status")
    .upsert(
      {
        field_staff_account_id: session.accountId,
        restaurant_id: KIARA_RESTAURANT_ID,
        permission: input.permission,
        services_enabled: input.servicesEnabled,
        background_capable: input.backgroundCapable,
        platform: input.platform,
        app_version: input.appVersion,
        reported_at: new Date().toISOString(),
      },
      { onConflict: "field_staff_account_id" },
    );
  if (error) {
    console.warn("[driver-tracking] location status not saved", error.message);
    return false;
  }
  return true;
}

async function lastLocationRequestAt(orderId: string): Promise<string | null> {
  const { data } = await getAdminSupabaseClient()
    .from("operation_events")
    .select("occurred_at")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("aggregate_type", "driver_order")
    .eq("aggregate_id", orderId)
    .eq("event_type", "field.location_permission_requested")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return text(data?.occurred_at);
}

async function tripFixes(orderId: string): Promise<TrackFix[]> {
  const { data, error } = await getAdminSupabaseClient()
    .from("driver_trip_locations")
    .select("latitude, longitude, accuracy_meters, speed_mps, captured_at")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("order_id", orderId)
    .order("captured_at", { ascending: true })
    .limit(2_000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    at: String(row.captured_at),
    accuracyMeters: Number(row.accuracy_meters),
    speedMps: row.speed_mps == null ? null : Number(row.speed_mps),
  }));
}

/** Pins for an order that has no punctuality plan (a pin was missing then). */
async function fallbackPlaces(orderId: string): Promise<{ specialist: Point | null; client: Point | null }> {
  const admin = getAdminSupabaseClient();
  const { data: order } = await admin
    .from("driver_orders")
    .select("customer_location, specialist_id, rekaz_source_id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { specialist: null, client: null };
  const [specialistRow, rekaz] = await Promise.all([
    order.specialist_id
      ? admin
          .from("specialists")
          .select("pickup_latitude, pickup_longitude")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .eq("id", String(order.specialist_id))
          .maybeSingle()
      : Promise.resolve({ data: null }),
    order.rekaz_source_id
      ? admin
          .from("rekaz_reservations")
          .select("payload")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .eq("source_id", String(order.rekaz_source_id))
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const specialist = finitePoint(
    specialistRow.data?.pickup_latitude,
    specialistRow.data?.pickup_longitude,
  );
  const rekazLocation = (rekaz.data?.payload as { location?: unknown } | null)?.location ?? null;
  const client = await clientPointOf(String(order.customer_location ?? ""), rekazLocation)
    .catch(() => null);
  return { specialist, client };
}

function tripWindow(progress: Row | null, status: string, plan: Row | null) {
  const startedAt = text(progress?.driver_confirmed_at);
  const endedAt = text(
    plan?.client_geofence_at ??
      progress?.driver_client_arrived_at ??
      progress?.service_started_at ??
      progress?.completed_at,
  );
  const state: OrderTracking["trip"]["state"] = status === "cancelled"
    ? "cancelled"
    : !startedAt
      ? "not_started"
      : trackingActive(plan, progress, status) ? "active" : "finished";
  return { startedAt, endedAt, state };
}

/** Drive time between two points at this driver's pace; zero inside the fence. */
async function drive(from: Point, to: Point, speed: { kph: number; live: boolean }, geofenceMetres: number) {
  if (metresBetween(from, to) <= geofenceMetres) return { distanceMetres: 0, seconds: 0, osrm: false };
  const route = await routeBetween(from, to, speed.kph);
  // A real road route keeps its own duration; the straight-line estimate is
  // re-timed with the speed this driver is actually making.
  const seconds = route.source === "osrm" && !speed.live
    ? route.durationSeconds
    : Math.round(route.distanceMetres / (speed.kph / 3.6));
  return { distanceMetres: route.distanceMetres, seconds, osrm: route.source === "osrm" };
}

async function clientEtaFor(input: {
  latest: TrackFix;
  fixes: TrackFix[];
  places: { specialist: Point | null; client: Point };
  progress: Row | null;
  scheduledAt: string;
  config: { fallback_speed_kph: number; geofence_metres: number; pickup_buffer_minutes: number };
}): Promise<ClientEta> {
  const nowMs = Date.now();
  const fixMs = Date.parse(input.latest.at);
  const here = { lat: input.latest.lat, lng: input.latest.lng };
  const speed = plannedSpeedKph(input.fixes, nowMs, Number(input.config.fallback_speed_kph));
  const fence = Number(input.config.geofence_metres);
  const bufferMs = Number(input.config.pickup_buffer_minutes) * 60_000;
  const { specialist, client } = input.places;
  const arrivedMs = msOf(input.progress?.driver_arrived_at);

  let atMs: number;
  let distanceMetres: number;
  let osrm: boolean;
  let stage: ClientEta["stage"];
  let approximate = false;
  if (input.progress?.specialist_pickup_at) {
    const leg = await drive(here, client, speed, fence);
    atMs = Math.max(nowMs, fixMs + leg.seconds * 1_000);
    ({ distanceMetres, osrm } = leg);
    stage = "to_client";
  } else if (arrivedMs != null) {
    // Parked at the specialist's: what is left of her few minutes, then the drive.
    const leg = await drive(specialist ?? here, client, speed, fence);
    atMs = nowMs + Math.max(0, bufferMs - (nowMs - arrivedMs)) + leg.seconds * 1_000;
    ({ distanceMetres, osrm } = leg);
    stage = "waiting_specialist";
  } else if (specialist) {
    const [toSpecialist, toClient] = await Promise.all([
      drive(here, specialist, speed, fence),
      drive(specialist, client, speed, fence),
    ]);
    atMs = Math.max(nowMs, fixMs + toSpecialist.seconds * 1_000) + bufferMs + toClient.seconds * 1_000;
    distanceMetres = toSpecialist.distanceMetres + toClient.distanceMetres;
    osrm = toSpecialist.osrm && toClient.osrm;
    stage = "to_specialist";
  } else {
    // No pickup pin: the detour to her is unknown, so this is the straight
    // run to the client plus her usual few minutes — said to be approximate.
    const leg = await drive(here, client, speed, fence);
    atMs = Math.max(nowMs, fixMs + leg.seconds * 1_000) + bufferMs;
    ({ distanceMetres, osrm } = leg);
    stage = "to_specialist";
    approximate = true;
  }
  return {
    at: new Date(atMs).toISOString(),
    remainingSeconds: Math.max(0, Math.round((atMs - nowMs) / 1_000)),
    distanceMetres,
    scheduledAt: input.scheduledAt,
    lateByMinutes: Math.round((atMs - Date.parse(input.scheduledAt)) / 60_000),
    stage,
    approximate,
    source: speed.live ? "live_speed" : osrm ? "osrm" : "estimate",
  };
}

async function etaFor(input: {
  latest: TrackFix;
  fixes: TrackFix[];
  target: "specialist" | "client";
  point: Point;
  scheduledAt: string | null;
  fallbackKph: number;
  geofenceMetres: number;
}): Promise<NonNullable<OrderTracking["eta"]>> {
  const nowMs = Date.now();
  const from = { lat: input.latest.lat, lng: input.latest.lng };
  const speed = plannedSpeedKph(input.fixes, nowMs, input.fallbackKph);
  const { distanceMetres, seconds, osrm } = await drive(from, input.point, speed, input.geofenceMetres);
  const source: "live_speed" | "osrm" | "estimate" = speed.live ? "live_speed" : osrm ? "osrm" : "estimate";
  // Counted from the fix, not from now: a fix two minutes old already left
  // two minutes of the drive behind it.
  const atMs = Math.max(nowMs, Date.parse(input.latest.at) + seconds * 1_000);
  const scheduledMs = msOf(input.scheduledAt);
  return {
    target: input.target,
    at: new Date(atMs).toISOString(),
    remainingSeconds: Math.max(0, Math.round((atMs - nowMs) / 1_000)),
    distanceMetres,
    source,
    scheduledAt: input.scheduledAt,
    lateByMinutes: scheduledMs == null ? null : Math.round((atMs - scheduledMs) / 60_000),
  };
}

export async function getOrderTracking(orderId: string): Promise<OrderTracking | null> {
  const [{ order, progress }, config] = await Promise.all([orderAndProgress(orderId), settings()]);
  if (!order) return null;

  const switchedOff = process.env.DRIVER_TRIP_TRACKING === "off" || !config.tracking_starts_at;
  const enabled = tripTrackingEnabled(order, config);
  const driverId = order.driver_id;

  // Planning may call a route service; the rest is plain reads. Each piece
  // is allowed to fail alone.
  const [punctuality, fixes, status, canReceivePush, lastRequestAt, driverRow] = await Promise.all([
    enabled
      ? Promise.race([
          getOrderPunctuality(orderId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
        ]).catch(() => null)
      : Promise.resolve(null),
    tripFixes(orderId).catch(() => [] as TrackFix[]),
    driverId ? getDriverLocationStatus(driverId).catch(() => null) : Promise.resolve(null),
    driverId ? driverCanReceivePush(driverId).catch(() => false) : Promise.resolve(false),
    lastLocationRequestAt(orderId).catch(() => null),
    driverId
      ? getAdminSupabaseClient()
          .from("drivers")
          .select("full_name")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .eq("id", driverId)
          .maybeSingle()
          .then((result) => result.data)
      : Promise.resolve(null),
  ]);
  const plan = await loadPlan(orderId).catch(() => null);

  const places = plan
    ? {
        specialist: finitePoint(plan.specialist_latitude, plan.specialist_longitude),
        client: finitePoint(plan.client_latitude, plan.client_longitude),
      }
    : await Promise.race([
        fallbackPlaces(orderId),
        new Promise<{ specialist: null; client: null }>((resolve) =>
          setTimeout(() => resolve({ specialist: null, client: null }), 3_000),
        ),
      ]).catch(() => ({ specialist: null, client: null }));

  const trip = tripWindow(progress, order.status, plan);
  const usable = usableFixes(fixes);
  const latestFix = usable[usable.length - 1] ?? null;
  const nowMs = Date.now();
  const startMs = msOf(trip.startedAt);
  const endMs = trip.state === "active" ? nowMs : msOf(trip.endedAt);
  const stats = trackStats(usable, { fromMs: startMs, toMs: endMs });

  // Heading for the specialist until she is in the car; without her pin the
  // client is the only stop that can be estimated.
  const pickedUp = Boolean(progress?.specialist_pickup_at);
  const etaTarget: "specialist" | "client" = pickedUp || !places.specialist ? "client" : "specialist";
  const targetPoint = etaTarget === "client" ? places.client : places.specialist;
  const freshEnough = latestFix && nowMs - Date.parse(latestFix.at) <= 10 * 60_000;
  const eta = trip.state === "active" && latestFix && freshEnough && targetPoint
    ? await etaFor({
        latest: latestFix,
        fixes: usable,
        target: etaTarget,
        point: targetPoint,
        scheduledAt: etaTarget === "client"
          ? order.arrival_at
          : text(plan?.planned_specialist_arrival_at),
        fallbackKph: Number(config.fallback_speed_kph),
        geofenceMetres: Number(config.geofence_metres),
      }).catch(() => null)
    : null;
  const clientPoint = places.client;
  const clientEta = trip.state === "active" && latestFix && freshEnough && clientPoint
    ? await clientEtaFor({
        latest: latestFix,
        fixes: usable,
        places: { specialist: places.specialist, client: clientPoint },
        progress,
        scheduledAt: order.arrival_at,
        config,
      }).catch(() => null)
    : null;

  const specialistTapDistance = tapDistanceFrom(usable, text(progress?.driver_arrived_at), places.specialist);
  const clientTapDistance = tapDistanceFrom(usable, text(progress?.driver_client_arrived_at), places.client);
  const milestones: TrackingMilestone[] = [
    {
      key: "confirmed",
      at: trip.startedAt,
      source: trip.startedAt ? "tap" : null,
      plannedAt: text(plan?.planned_driver_departure_at),
      tapDistanceMetres: null,
    },
    {
      key: "departed",
      at: text(plan?.driver_departed_at),
      source: plan?.driver_departed_at ? "gps" : null,
      plannedAt: null,
      tapDistanceMetres: null,
    },
    {
      key: "specialist_arrived",
      at: text(plan?.specialist_geofence_at ?? progress?.driver_arrived_at),
      source: plan?.specialist_geofence_at ? "gps" : progress?.driver_arrived_at ? "tap" : null,
      plannedAt: text(plan?.planned_specialist_arrival_at),
      tapDistanceMetres: plan?.specialist_geofence_at ? null : specialistTapDistance,
    },
    {
      key: "pickup",
      at: text(progress?.specialist_pickup_at),
      source: progress?.specialist_pickup_at ? "tap" : null,
      plannedAt: null,
      tapDistanceMetres: null,
    },
    {
      key: "client_arrived",
      at: text(plan?.client_geofence_at ?? progress?.driver_client_arrived_at),
      source: plan?.client_geofence_at ? "gps" : progress?.driver_client_arrived_at ? "tap" : null,
      plannedAt: order.arrival_at,
      tapDistanceMetres: plan?.client_geofence_at ? null : clientTapDistance,
    },
    {
      key: "service_started",
      at: text(progress?.service_started_at),
      source: progress?.service_started_at ? "tap" : null,
      plannedAt: null,
      tapDistanceMetres: null,
    },
  ];

  const flags: TrackingFlag[] = [];
  if (specialistTapDistance != null && specialistTapDistance > TAP_DISTANCE_FLAG_METRES && !plan?.specialist_geofence_at) {
    flags.push({ code: "tap_far_from_specialist", metres: specialistTapDistance });
  }
  if (clientTapDistance != null && clientTapDistance > TAP_DISTANCE_FLAG_METRES && !plan?.client_geofence_at) {
    flags.push({ code: "tap_far_from_client", metres: clientTapDistance });
  }
  if (trip.state === "active" && latestFix) {
    const age = Math.round((nowMs - Date.parse(latestFix.at)) / 1_000);
    if (age > STALE_FLAG_SECONDS) flags.push({ code: "stale", minutes: Math.round(age / 60) });
  }
  if (stats.longestGapSeconds != null && stats.longestGapSeconds > STALE_FLAG_SECONDS && usable.length > 0) {
    flags.push({ code: "gps_gap", minutes: Math.round(stats.longestGapSeconds / 60) });
  }
  if (enabled && trip.state !== "not_started" && trip.state !== "cancelled" && !usable.length) {
    flags.push({ code: "no_fixes" });
  }
  const grace = Number(config.grace_minutes);
  if (eta?.target === "specialist" && eta.lateByMinutes != null && eta.lateByMinutes > grace) {
    flags.push({ code: "expected_late", minutes: eta.lateByMinutes, target: "specialist" });
  }
  const clientLate = clientEta?.lateByMinutes ?? (eta?.target === "client" ? eta.lateByMinutes : null);
  if (clientLate != null && clientLate > grace) {
    flags.push({ code: "expected_late", minutes: clientLate, target: "client" });
  }

  const path = downsample(usable, MAX_PATH_POINTS).map((fix) => ({ lat: fix.lat, lng: fix.lng, at: fix.at }));
  return {
    enabled,
    disabledReason: enabled ? null : switchedOff ? "switched_off" : "order_before_tracking",
    driver: driverId
      ? {
          id: driverId,
          name: text(driverRow?.full_name),
          status,
          canReceivePush,
          lastRequestAt,
        }
      : null,
    trip,
    points: path,
    latest: latestFix
      ? {
          lat: latestFix.lat,
          lng: latestFix.lng,
          at: latestFix.at,
          accuracyMeters: Math.round(latestFix.accuracyMeters),
          speedKph: latestFix.speedMps == null ? null : Math.round(latestFix.speedMps * 3.6),
          freshnessSeconds: Math.max(0, Math.round((nowMs - Date.parse(latestFix.at)) / 1_000)),
        }
      : null,
    places: {
      start: finitePoint(plan?.driver_start_latitude, plan?.driver_start_longitude) ??
        (usable[0] ? { lat: usable[0].lat, lng: usable[0].lng } : null),
      specialist: places.specialist,
      client: places.client,
    },
    eta,
    clientEta,
    stats,
    milestones,
    flags,
    punctuality,
  };
}

export class LocationRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Sends the employee-approved "please allow location" push to the order's driver. */
export async function requestDriverLocationPermission(input: {
  orderId: string;
  title: string;
  body: string;
  actor: { userId: string; teamMemberId: string | null; role: string };
}) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > 80) {
    throw new LocationRequestError(400, "INVALID_TITLE", "title must be 1–80 characters");
  }
  if (!body || body.length > 400) {
    throw new LocationRequestError(400, "INVALID_BODY", "body must be 1–400 characters");
  }
  const { order } = await orderAndProgress(input.orderId);
  if (!order) throw new LocationRequestError(404, "ORDER_NOT_FOUND", "Order not found");
  if (!order.driver_id) {
    throw new LocationRequestError(409, "NO_DRIVER", "This order has no driver yet");
  }
  const push = await notifyDriverLocationRequest({
    orderId: input.orderId,
    driverId: order.driver_id,
    title,
    body,
  });
  await getAdminSupabaseClient()
    .from("operation_events")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      aggregate_type: "driver_order",
      aggregate_id: input.orderId,
      event_type: "field.location_permission_requested",
      actor_type: input.actor.teamMemberId ? "team_member" : "owner",
      actor_role: input.actor.role === "admin" ? "admin" : "agent",
      actor_user_id: input.actor.userId,
      actor_team_member_id: input.actor.teamMemberId,
      payload: {
        rosterId: order.driver_id,
        pushAttempted: push.attempted,
        pushAccepted: push.accepted,
        pushDelivered: push.delivered,
      },
    })
    .then(
      () => undefined,
      (error) => console.error("[driver-tracking] request not audited", error),
    );
  return push;
}
