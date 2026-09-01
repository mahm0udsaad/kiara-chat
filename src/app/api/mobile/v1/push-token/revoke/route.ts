import { revokeFieldPushTokenByIdentity } from "@/lib/field-push";
import { revokeInboxPushTokenByIdentity } from "@/lib/inbox-notifications";
import { mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";

const EXPO_TOKEN = /^(Exponent|Expo)PushToken\[[^\]]+\]$/;

/**
 * Device-capability revocation for a session that has already expired.
 *
 * The Expo token is an unguessable capability already stored in the device's
 * secure keychain. This endpoint can only disable that exact token/device pair;
 * it cannot list, register, or reassign anything, and always returns the same
 * result so it exposes no account information.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    kind?: unknown;
    expoToken?: unknown;
    deviceId?: unknown;
  } | null;
  const kind = body?.kind;
  const expoToken = typeof body?.expoToken === "string" ? body.expoToken.trim() : "";
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
  if (
    (kind !== "inbox" && kind !== "field") ||
    !EXPO_TOKEN.test(expoToken) ||
    deviceId.length < 8 ||
    deviceId.length > 200
  ) {
    return mobileError(400, "INVALID_DEVICE_IDENTITY", "Invalid device identity");
  }

  try {
    if (kind === "inbox") {
      await revokeInboxPushTokenByIdentity({ expoToken, deviceId });
    } else {
      await revokeFieldPushTokenByIdentity({ expoToken, deviceId });
    }
    return mobileData({ revoked: true });
  } catch (error) {
    return mobileServerError(error, "PUSH_REVOKE_FAILED", "Unable to revoke notifications");
  }
}
