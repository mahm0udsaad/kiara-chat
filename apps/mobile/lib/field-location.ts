/**
 * Where a field step was confirmed.
 *
 * Every step the driver and the specialist tap is evidence: it says the ride
 * started, she got in, the service began at the customer's home. Without a
 * position all of that is a claim about a place, made from anywhere.
 *
 * The rule this file exists to enforce is that evidence must never become a
 * gate. A driver in a basement garage, a phone that denied the permission
 * months ago, a fix that takes longer than the customer will wait — none of
 * these may stop him advancing the order. When a position cannot be had, the
 * step still goes through, recorded as a manual exception with a written
 * reason, and the audit shows plainly which steps are unverified.
 */
import * as Location from "expo-location";

/** Matches `FieldLocationEvidence` on the server. */
export type FieldLocationEvidence = {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  capturedAt?: string;
  source: "device" | "manual_exception";
  permissionState?: string;
  exceptionReason?: string;
};

/**
 * Long enough for a warm GPS fix outdoors, short enough that a driver standing
 * at a gate does not think the app has hung. A slow fix becomes an exception,
 * not a wait.
 */
const FIX_TIMEOUT_MS = 6_000;

export type CaptureResult =
  | { ok: true; evidence: FieldLocationEvidence }
  | { ok: false; reason: "permission" | "disabled" | "timeout" | "error"; permissionState?: string };

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

/**
 * Try to fix the current position.
 *
 * Never throws and never blocks longer than {@link FIX_TIMEOUT_MS}: every
 * failure path returns a reason the caller can turn into an exception.
 */
export async function captureFieldLocation(): Promise<CaptureResult> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    let status = existing.status;
    // Only ask when it has never been decided. Re-prompting a driver who said
    // no once, on every step, teaches him to dismiss the app's dialogs.
    if (status !== "granted" && existing.canAskAgain) {
      status = (await Location.requestForegroundPermissionsAsync()).status;
    }
    if (status !== "granted") {
      return { ok: false, reason: "permission", permissionState: status };
    }

    if (!(await Location.hasServicesEnabledAsync())) {
      return { ok: false, reason: "disabled", permissionState: status };
    }

    const position = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      FIX_TIMEOUT_MS,
    );
    if (!position) return { ok: false, reason: "timeout", permissionState: status };

    return {
      ok: true,
      evidence: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        // The server's CHECK requires a non-negative accuracy on device
        // evidence, and some Android fixes report none.
        accuracyMeters: Math.max(position.coords.accuracy ?? 0, 0),
        capturedAt: new Date(position.timestamp).toISOString(),
        source: "device",
        permissionState: status,
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** What to write on the exception when the driver does not type his own. */
export function defaultExceptionReason(reason: "permission" | "disabled" | "timeout" | "error"): string {
  switch (reason) {
    case "permission":
      return "إذن الموقع غير مفعّل على الجهاز";
    case "disabled":
      return "خدمة الموقع مغلقة على الجهاز";
    case "timeout":
      return "تعذّر تحديد الموقع في الوقت المتاح";
    default:
      return "تعذّر تحديد الموقع على هذا الجهاز";
  }
}

/** Turn a failed capture into evidence the server will accept. */
export function exceptionEvidence(
  result: Extract<CaptureResult, { ok: false }>,
  typedReason?: string,
): FieldLocationEvidence {
  const reason = typedReason?.trim() || defaultExceptionReason(result.reason);
  return {
    source: "manual_exception",
    permissionState: result.permissionState,
    // The server requires 3–500 characters, so a one-word answer is padded
    // into something a report can actually read months later.
    exceptionReason: reason.length >= 3 ? reason.slice(0, 500) : defaultExceptionReason(result.reason),
  };
}
