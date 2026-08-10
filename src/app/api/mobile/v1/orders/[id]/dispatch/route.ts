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

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const specialistNote =
    typeof body.specialistNote === "string" ? body.specialistNote.trim() : "";

  if (!specialistId) {
    return mobileError(400, "SPECIALIST_REQUIRED", "specialistId is required");
  }
  if (!driverId) {
    return mobileError(400, "DRIVER_REQUIRED", "driverId is required");
  }
  if (!specialistNote) {
    return mobileError(
      400,
      "SPECIALIST_NOTE_REQUIRED",
      "specialistNote is required until mobile voice notes are available"
    );
  }
  if (specialistNote.length > 500) {
    return mobileError(
      400,
      "SPECIALIST_NOTE_TOO_LONG",
      "specialistNote cannot exceed 500 characters"
    );
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
      specialistNote,
    });
    return mobileData({
      order: orderForMobileSession(result.order, auth.session),
      driverSent: result.sent,
      specialistSent: result.specialistSent,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("تم إرسال هذا الطلب بالفعل")
    ) {
      return mobileError(
        409,
        "ORDER_ALREADY_DISPATCHED",
        "The order was already dispatched"
      );
    }
    return mobileServerError(
      error,
      "ORDER_DISPATCH_FAILED",
      "Unable to dispatch the order"
    );
  }
}
