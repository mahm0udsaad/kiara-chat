/**
 * The driver's location permission: reading it, asking for it, and telling
 * the office what it is.
 *
 * Location is optional evidence. Nothing in this file may block a step, throw
 * into a screen, or raise the system dialog on its own — the only call that
 * shows the OS prompt is `askLocationPermission`, and only the permission
 * window calls it, after the driver taps "allow". A driver who refuses, or a
 * phone where any of this fails, runs every step exactly as before.
 */
import Constants from "expo-constants";
import * as Location from "expo-location";
import { requireOptionalNativeModule } from "expo";
import { Linking, Platform } from "react-native";

import { apiRequest } from "@/lib/api";
import type { LocationPermissionState } from "@/types/api";

export type LocationSnapshot = {
  permission: LocationPermissionState;
  /** The OS will still show its dialog (false = Settings is the only way). */
  canAskAgain: boolean;
  /** Location services (GPS) switched on for the whole phone; null if unknown. */
  servicesEnabled: boolean | null;
};

const UNAVAILABLE: LocationSnapshot = {
  permission: "unavailable",
  canAskAgain: false,
  servicesEnabled: null,
};

function snapshotOf(
  response: Location.LocationPermissionResponse,
  servicesEnabled: boolean | null,
): LocationSnapshot {
  const permission: LocationPermissionState =
    response.status === "granted"
      ? "granted"
      : response.status === "undetermined"
        ? "undetermined"
        : response.canAskAgain
          ? "denied"
          : "blocked";
  return { permission, canAskAgain: response.canAskAgain, servicesEnabled };
}

async function servicesEnabled(): Promise<boolean | null> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    return null;
  }
}

/** Current state, without ever prompting. Never throws. */
export async function readLocationPermission(): Promise<LocationSnapshot> {
  try {
    const [response, services] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      servicesEnabled(),
    ]);
    return snapshotOf(response, services);
  } catch {
    return UNAVAILABLE;
  }
}

/** Shows the OS dialog when it still can. Only the permission window calls this. */
export async function askLocationPermission(): Promise<LocationSnapshot> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === "granted" || !current.canAskAgain) {
      return snapshotOf(current, await servicesEnabled());
    }
    const response = await Location.requestForegroundPermissionsAsync();
    return snapshotOf(response, await servicesEnabled());
  } catch {
    return readLocationPermission();
  }
}

/** Android's own "turn on location" dialog, for a phone with GPS switched off. */
export async function askToEnableLocationServices(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    await Location.enableNetworkProviderAsync();
    return (await servicesEnabled()) === true;
  } catch {
    return false;
  }
}

export function openAppSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

/** Whether this build can keep tracking while another app is in front. */
export function canTrackInBackground(): boolean {
  return Platform.OS === "android" && Boolean(requireOptionalNativeModule("ExpoTaskManager"));
}

let lastReported: { key: string; at: number } | null = null;
const REPORT_EVERY_MS = 10 * 60_000;

/**
 * Tells the server what this phone allows. Fire-and-forget: the same state is
 * sent at most every ten minutes, a change at once, and a failure is silent.
 */
export function reportLocationStatus(snapshot: LocationSnapshot): void {
  noteLocationSnapshot(snapshot);
  const key = `${snapshot.permission}|${snapshot.servicesEnabled}`;
  const now = Date.now();
  if (lastReported?.key === key && now - lastReported.at < REPORT_EVERY_MS) return;
  lastReported = { key, at: now };
  void apiRequest("/field/location-status", {
    method: "POST",
    body: JSON.stringify({
      permission: snapshot.permission,
      servicesEnabled: snapshot.servicesEnabled,
      backgroundCapable: canTrackInBackground(),
      platform: Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : "web",
      appVersion: Constants.expoConfig?.version ?? null,
    }),
  }).catch(() => {
    // Let the next foreground try again rather than waiting ten minutes.
    lastReported = null;
  });
}

/*
 * The office asked for location (a push arrived or was tapped). A tap that
 * cold-starts the app lands before the permission window is mounted, so an
 * unheard request waits for the first listener instead of being dropped.
 */
const promptListeners = new Set<() => void>();
let pendingPrompt = false;

export function requestLocationPrompt(): void {
  if (!promptListeners.size) {
    pendingPrompt = true;
    return;
  }
  for (const listener of promptListeners) listener();
}

export function onLocationPromptRequested(listener: () => void): () => void {
  promptListeners.add(listener);
  if (pendingPrompt) {
    pendingPrompt = false;
    listener();
  }
  return () => {
    promptListeners.delete(listener);
  };
}

/* Location became usable (allowed, or GPS switched on): a running order screen restarts its trip. */
const grantedListeners = new Set<() => void>();
let lastUsable: boolean | null = null;

/** Called with every fresh snapshot; fires listeners when location turns usable. */
export function noteLocationSnapshot(snapshot: LocationSnapshot): void {
  const usable = snapshot.permission === "granted" && snapshot.servicesEnabled !== false;
  const becameUsable = usable && lastUsable === false;
  lastUsable = usable;
  if (becameUsable) for (const listener of grantedListeners) listener();
}

export function onLocationBecameUsable(listener: () => void): () => void {
  grantedListeners.add(listener);
  return () => {
    grantedListeners.delete(listener);
  };
}
