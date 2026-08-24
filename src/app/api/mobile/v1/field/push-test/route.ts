import { testFieldPushDelivery } from "@/lib/field-push";
import {
  authorizeFieldStaffRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export async function POST(request: Request) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
  if (deviceId.length < 8 || deviceId.length > 200) {
    return mobileError(400, "INVALID_DEVICE_ID", "A valid deviceId is required");
  }
  try {
    const delivery = await testFieldPushDelivery(auth.session.accountId, deviceId);
    return mobileData({ delivery });
  } catch (error) {
    return mobileServerError(
      error,
      "FIELD_PUSH_TEST_FAILED",
      "Unable to test notifications",
    );
  }
}
