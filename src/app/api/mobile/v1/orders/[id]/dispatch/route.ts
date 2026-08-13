import { dispatchBooking } from "@/lib/dispatch";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import {
  getVisibleOrderConversationId,
  orderForMobileSession,
} from "@/lib/mobile/orders";
import { OperationalCommandError } from "@/lib/operational-commands";

export const runtime = "nodejs";
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return mobileError(400, "INVALID_JSON", "A JSON object is required");
  }
  const body = payload as Record<string, unknown>;
  const specialistId =
    typeof body.specialistId === "string" ? body.specialistId.trim() : "";
  const driverId = typeof body.driverId === "string" ? body.driverId.trim() : "";
  const driverMessage =
    typeof body.driverMessage === "string" ? body.driverMessage.trim() : "";
  const specialistMessage =
    typeof body.specialistMessage === "string" ? body.specialistMessage.trim() : "";
  const expectedVersion = Number(body.expectedVersion);
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!specialistId) {
    return mobileError(400, "SPECIALIST_REQUIRED", "specialistId is required");
  }
  if (!driverId) {
    return mobileError(400, "DRIVER_REQUIRED", "driverId is required");
  }
  if (!driverMessage) {
    return mobileError(
      400,
      "DRIVER_MESSAGE_REQUIRED",
      "driverMessage is required",
    );
  }
  if (!specialistMessage) {
    return mobileError(
      400,
      "SPECIALIST_MESSAGE_REQUIRED",
      "specialistMessage is required",
    );
  }
  if (driverMessage.length > 3_000 || specialistMessage.length > 3_000) {
    return mobileError(400, "DISPATCH_MESSAGE_TOO_LONG", "Messages cannot exceed 3000 characters");
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return mobileError(400, "EXPECTED_VERSION_REQUIRED", "expectedVersion must be a positive integer");
  }
  if (!UUID.test(idempotencyKey)) {
    return mobileError(400, "IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey must be a UUID");
  }

  const { id } = await params;
  try {
    const conversationId = await getVisibleOrderConversationId(id, auth.session);
    if (!conversationId) {
      return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    const result = await dispatchBooking(id, {
      specialistId,
      driverId,
      driverMessage,
      specialistMessage,
      expectedVersion,
      idempotencyKey,
      actor: {
        userId: auth.session.userId,
        teamMemberId: auth.session.teamMemberId,
        role: auth.session.role,
      },
    });
    return mobileData({
      order: orderForMobileSession(result.order, auth.session),
      driverSent: result.sent,
      specialistSent: result.specialistSent,
    });
  } catch (error) {
    if (error instanceof OperationalCommandError && error.isConflict) {
      return mobileError(
        409,
        error.code,
        "The order changed or another employee is dispatching it. Refresh before continuing.",
      );
    }
    if (error instanceof Error && error.message.includes("تم إرسال هذا الطلب بالفعل")) {
      return mobileError(409, "ORDER_ALREADY_DISPATCHED", "The order was already dispatched");
    }
    return mobileServerError(
      error,
      "ORDER_DISPATCH_FAILED",
      "Unable to dispatch the order"
    );
  }
}
