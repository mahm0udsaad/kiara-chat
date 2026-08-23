import { createBooking } from "@/lib/dispatch";
import { getConversationById } from "@/lib/inbox";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export const runtime = "nodejs";

/**
 * Confirm a booking from the phone — the mobile half of the web inbox's
 * "تأكيد الحجز".
 *
 * Creates the pending visit only. Choosing the specialist and driver stays in
 * the dispatch screen, where the exact outbound WhatsApp text is reviewed
 * before anything is sent, so this endpoint never messages anyone.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return mobileError(400, "INVALID_JSON", "A JSON object is required");
  }

  const arrivalAt =
    typeof body.arrivalAt === "string" ? body.arrivalAt.trim() : "";
  const customerLocation =
    typeof body.customerLocation === "string"
      ? body.customerLocation.trim()
      : "";
  const durationMinutes = Number(body.durationMinutes);
  const tripType = body.tripType === "round_trip" ? "round_trip" : "one_way";

  if (!arrivalAt || Number.isNaN(Date.parse(arrivalAt))) {
    return mobileError(400, "INVALID_ARRIVAL", "موعد الوصول غير صحيح");
  }
  if (!customerLocation) {
    return mobileError(400, "LOCATION_REQUIRED", "موقع العميلة مطلوب");
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return mobileError(400, "INVALID_DURATION", "مدة الجلسة غير صحيحة");
  }

  const { id } = await params;

  try {
    // Same visibility rule as every other per-conversation mobile route: a
    // thread routed to someone else is not this employee's to book.
    const conversation = await getConversationById(id, {
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
    });
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }

    const order = await createBooking(auth.session.userId, {
      conversationId: id,
      arrivalAt,
      customerLocation,
      durationMinutes,
      tripType,
    });
    return mobileData({ order: { ...order, price: null } }, 201);
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_ORDER_FAILED",
      "تعذّر إنشاء الحجز"
    );
  }
}
