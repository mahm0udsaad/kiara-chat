/**
 * Driver GPS for one active trip, from accepting the ride to reaching the
 * client.
 *
 * Drivers navigate with Google Maps, which puts Kiara in the background for
 * the whole drive. On Android the trip therefore runs as a foreground service
 * (a persistent "رحلة جارية" notification) that keeps sending fixes with the
 * ordinary "while using the app" permission — no "allow all the time" prompt.
 *
 * The service needs the ExpoTaskManager native module, which only builds from
 * this version onward carry. On an older build, or on iOS, it falls back to a
 * watcher that runs while the order screen is open. Either way the samples are
 * telemetry: nothing here may block or slow the field workflow, and the server
 * judges the visit from the step taps when GPS is missing.
 *
 * It never asks for permission. The driver grants it (or not) in the location
 * window (components/field/location-permission-gate); here a phone without it
 * simply sends nothing, and the steps run exactly as they always have.
 *
 * The service stops itself when the server says the trip is over (client
 * reached, service started, cancelled, reassigned), and after a hard cap in
 * case the phone never hears back.
 */
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { requireOptionalNativeModule } from "expo";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { ApiError, apiRequest } from "@/lib/api";
import { onLocationBecameUsable } from "@/lib/driver-location";
import type { PunctualitySummary } from "@/types/api";

type SampleResponse = {
  /** Null when the order has no punctuality plan; the path is still kept. */
  punctuality: PunctualitySummary | null;
  /** Absent on servers that predate it, where `punctuality` always exists. */
  trackingActive?: boolean;
};

/**
 * Master switch on the phone. The server has its own (an empty
 * `tracking_starts_at`, or DRIVER_TRIP_TRACKING=off), which stops every phone
 * on its next sample without shipping an update.
 */
const TRIP_TRACKING_ENABLED = true;

const TASK = "kiara-driver-trip";
const TRIP_KEY = "kiara.driverTrip.v1";
/** One fix per 20 s is plenty to catch a 125 m fence at city speeds. */
const SEND_EVERY_MS = 20_000;
/** No outbound leg lasts this long; a service still running is stale. */
const MAX_TRIP_MS = 4 * 60 * 60_000;

type Trip = { orderId: string; startedAt: number };
type TaskManagerModule = typeof import("expo-task-manager");

let taskManagerCache: TaskManagerModule | null | undefined;

/** expo-task-manager, or null where the native module is absent (older builds, iOS). */
function taskManager(): TaskManagerModule | null {
  if (taskManagerCache !== undefined) return taskManagerCache;
  taskManagerCache = null;
  if (Platform.OS === "android" && requireOptionalNativeModule("ExpoTaskManager")) {
    try {
      // Lazy on purpose: evaluating it on a build without the native module throws.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
            taskManagerCache = require("expo-task-manager") as TaskManagerModule;
    } catch {
      taskManagerCache = null;
    }
  }
  return taskManagerCache;
}

let tripCache: Trip | null | undefined;

async function readTrip(): Promise<Trip | null> {
  if (tripCache !== undefined) return tripCache;
  try {
    const raw = await SecureStore.getItemAsync(TRIP_KEY);
    tripCache = raw ? (JSON.parse(raw) as Trip) : null;
  } catch {
    tripCache = null;
  }
  return tripCache;
}

async function writeTrip(trip: Trip | null): Promise<void> {
  tripCache = trip;
  try {
    if (trip) await SecureStore.setItemAsync(TRIP_KEY, JSON.stringify(trip));
    else await SecureStore.deleteItemAsync(TRIP_KEY);
  } catch {
    // The in-memory copy still drives this process.
  }
}

const listeners = new Set<(orderId: string) => void>();
let inFlight = false;
let lastSentAt = 0;

async function stopTrip(): Promise<void> {
  await writeTrip(null);
  if (!taskManager()) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) {
      await Location.stopLocationUpdatesAsync(TASK);
    }
  } catch {
    // Already stopped.
  }
}

/** Stops the service only if it is tracking this order. */
async function stopTripFor(orderId: string): Promise<void> {
  const trip = await readTrip();
  if (trip?.orderId === orderId) await stopTrip();
}

async function sendSample(orderId: string, position: Location.LocationObject): Promise<void> {
  if (inFlight || Date.now() - lastSentAt < SEND_EVERY_MS) return;
  inFlight = true;
  lastSentAt = Date.now();
  try {
    const response = await apiRequest<SampleResponse>(
      `/field/orders/${orderId}/punctuality`,
      {
        method: "POST",
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Math.max(position.coords.accuracy ?? 0, 0),
          speedMps: position.coords.speed == null ? undefined : Math.max(position.coords.speed, 0),
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      },
    );
    for (const listener of listeners) listener(orderId);
    const active = response.trackingActive ?? response.punctuality?.trackingActive ?? true;
    if (!active) await stopTripFor(orderId);
  } catch (error) {
    // 409: the trip is over or not tracked. 403/404: no longer his order.
    if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
      await stopTripFor(orderId);
    }
  } finally {
    inFlight = false;
  }
}

// Background tasks must be defined when the bundle loads, before any screen,
// so a service that outlives the UI still has a handler.
const manager = taskManager();
if (manager && !manager.isTaskDefined(TASK)) {
  manager.defineTask<{ locations?: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    if (error) return;
    const locations = data?.locations ?? [];
    const latest = locations[locations.length - 1];
    const trip = await readTrip();
    if (!trip || Date.now() - trip.startedAt > MAX_TRIP_MS) {
      await stopTrip();
      return;
    }
    if (latest) await sendSample(trip.orderId, latest);
  });
}

/** Check only — the system dialog belongs to the location window, never to a trip. */
async function hasForegroundPermission(): Promise<boolean> {
  return (await Location.getForegroundPermissionsAsync()).status === "granted";
}

async function startTripService(orderId: string): Promise<boolean> {
  if (!taskManager()) return false;
  const trip = await readTrip();
  if (trip?.orderId !== orderId) await writeTrip({ orderId, startedAt: Date.now() });
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) return true;
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: SEND_EVERY_MS,
    distanceInterval: 30,
    foregroundService: {
      notificationTitle: "كيارا — رحلة جارية",
      notificationBody: "يُسجَّل موقع الرحلة حتى الوصول للعميلة فقط.",
      notificationColor: "#2B3FB0",
      killServiceOnDestroy: false,
    },
  });
  return true;
}

/**
 * Keeps trip tracking in step with the order the driver is looking at.
 *
 * `onUpdate` must be stable (useCallback). `active` is the server's
 * `tripTrackingActive` for this driver, or null while it is not known yet:
 * unknown must never stop a service that is already running for this order,
 * or reopening the screen would cut the trip.
 */
export function useDriverTripTracking(
  orderId: string,
  active: boolean | null,
  onUpdate: () => void,
) {
  useEffect(() => {
    const listener = (id: string) => {
      if (id === orderId) onUpdate();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [onUpdate, orderId]);

  // Location allowed from the permission window while this screen is open:
  // start the trip now rather than on the next visit to the order.
  const [usableTick, setUsableTick] = useState(0);
  useEffect(() => onLocationBecameUsable(() => setUsableTick((tick) => tick + 1)), []);

  useEffect(() => {
    // Telemetry only — the server judges a visit from the step taps when GPS
    // is missing — so nothing here waits on, or is awaited by, a step. No
    // permission: nothing is sent. Any failure: nothing is sent.
    if (!TRIP_TRACKING_ENABLED) {
      void stopTripFor(orderId);
      return;
    }
    if (!orderId || active === null) return;
    if (!active) {
      void stopTripFor(orderId);
      return;
    }
    let cancelled = false;
    let watcher: Location.LocationSubscription | null = null;

    void (async () => {
      try {
        if (!(await hasForegroundPermission()) || !(await Location.hasServicesEnabledAsync())) return;
        if (cancelled) return;
        if (await startTripService(orderId)) return;
      } catch {
        // Service refused (e.g. started from the background): use the watcher.
      }
      if (cancelled) return;
      try {
        const subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: SEND_EVERY_MS, distanceInterval: 30 },
          (position) => void sendSample(orderId, position),
        );
        if (cancelled) subscription.remove();
        else watcher = subscription;
      } catch {
        // No GPS: the server falls back to the step taps.
      }
    })();

    return () => {
      cancelled = true;
      watcher?.remove();
    };
  }, [active, orderId, usableTick]);
}
