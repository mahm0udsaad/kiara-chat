import { registerFieldPushToken, unregisterFieldPushToken } from "@/lib/field-push";
import {
  authorizeFieldStaffRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { withTransientUpstreamRetry } from "@/lib/mobile/transient-retry";

export async function POST(request: Request) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const expoToken = typeof body?.expoToken === "string" ? body.expoToken.trim() : "";
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
  if (!expoToken || !deviceId) {
    return mobileError(400, "INVALID_PUSH_TOKEN", "expoToken and deviceId are required");
  }
  try {
    await withTransientUpstreamRetry(
      () => registerFieldPushToken({ accountId: auth.session.accountId, expoToken, deviceId }),
      { label: "field push registration" },
    );
    return mobileData({ registered: true });
  } catch (error) {
    return mobileServerError(error, "PUSH_REGISTRATION_FAILED", "Unable to register notifications");
  }
}

export async function DELETE(request: Request) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
  if (!deviceId) return mobileError(400, "INVALID_DEVICE_ID", "deviceId is required");
  try {
    await unregisterFieldPushToken({ accountId: auth.session.accountId, deviceId });
    return mobileData({ registered: false });
  } catch (error) {
    return mobileServerError(error, "PUSH_UNREGISTER_FAILED", "Unable to unregister notifications");
  }
}
