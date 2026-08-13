import {
  registerInboxPushToken,
  unregisterInboxPushToken,
} from "@/lib/inbox-notifications";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

function bodyOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!auth.session.teamMemberId) {
    return mobileError(409, "TEAM_MEMBER_REQUIRED", "A team member account is required");
  }
  const body = bodyOf(await request.json().catch(() => ({})));
  const expoToken = typeof body.expoToken === "string" ? body.expoToken.trim() : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const platform = body.platform === "ios" || body.platform === "android" ? body.platform : null;
  if (!expoToken || !deviceId || !platform) {
    return mobileError(
      400,
      "INVALID_PUSH_TOKEN",
      "expoToken, deviceId, and platform are required"
    );
  }

  try {
    await registerInboxPushToken({
      teamMemberId: auth.session.teamMemberId,
      expoToken,
      deviceId,
      platform,
    });
    return mobileData({ registered: true });
  } catch (error) {
    return mobileServerError(
      error,
      "PUSH_REGISTRATION_FAILED",
      "Unable to register notifications"
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!auth.session.teamMemberId) {
    return mobileError(409, "TEAM_MEMBER_REQUIRED", "A team member account is required");
  }
  const body = bodyOf(await request.json().catch(() => ({})));
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  if (!deviceId) return mobileError(400, "INVALID_DEVICE_ID", "deviceId is required");

  try {
    await unregisterInboxPushToken({
      teamMemberId: auth.session.teamMemberId,
      deviceId,
    });
    return mobileData({ registered: false });
  } catch (error) {
    return mobileServerError(
      error,
      "PUSH_UNREGISTER_FAILED",
      "Unable to unregister notifications"
    );
  }
}
