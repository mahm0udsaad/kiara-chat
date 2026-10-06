import { LOCATION_PERMISSIONS, saveLocationStatus, type LocationPermission } from "@/lib/driver-tracking";
import {
  authorizeFieldStaffRequest,
  mobileData,
  mobileError,
} from "@/lib/mobile/http";

const PLATFORMS = new Set(["android", "ios", "web"]);

const flag = (value: unknown) => (typeof value === "boolean" ? value : null);

/**
 * POST /api/mobile/v1/field/location-status — the phone reports its own
 * location access (granted, refused, never asked…).
 *
 * Fire-and-forget from the app's side: it never waits on this, and a failed
 * save (for instance before the table's migration lands) still answers 200 so
 * nothing on the phone treats it as an error.
 */
export async function POST(request: Request) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const permission = body?.permission as LocationPermission;
  if (!LOCATION_PERMISSIONS.includes(permission)) {
    return mobileError(400, "INVALID_PERMISSION", "permission is not a known state");
  }
  const platform = typeof body?.platform === "string" && PLATFORMS.has(body.platform)
    ? body.platform
    : null;
  const appVersion = typeof body?.appVersion === "string"
    ? body.appVersion.trim().slice(0, 40) || null
    : null;

  const saved = await saveLocationStatus(auth.session, {
    permission,
    servicesEnabled: flag(body?.servicesEnabled),
    backgroundCapable: flag(body?.backgroundCapable),
    platform,
    appVersion,
  }).catch(() => false);
  return mobileData({ saved });
}
