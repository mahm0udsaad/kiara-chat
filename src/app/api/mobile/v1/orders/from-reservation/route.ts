import { createBookingFromReservation, RekazBookingError } from "@/lib/dispatch";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

/**
 * Raise the operational order for a Rekaz visit straight from the calendar.
 *
 * `طلب سائق` on an unlinked visit lands here. It creates only the pending
 * order — no message is sent and nothing is assigned — so the employee
 * continues into the dispatch preview, where the exact driver and specialist
 * text is shown and edited before anything leaves the building.
 *
 * A customer who has never written on WhatsApp is not a reason to refuse: the
 * visit is real work regardless, so the thread is opened for her rather than
 * demanded from her.
 */
export const runtime = "nodejs";

const ERROR_STATUS: Record<string, { status: number; message: string }> = {
  RESERVATION_NOT_FOUND: {
    status: 404,
    message: "هذا الحجز لم يعد موجودًا في ركاز — حدّثي التقويم",
  },
  RESERVATION_CANCELLED: {
    status: 409,
    message: "هذا الحجز ملغي في ركاز",
  },
  CUSTOMER_PHONE_INVALID: {
    status: 409,
    message: "رقم العميلة في ركاز غير صحيح — صحّحيه في ركاز ثم حدّثي التقويم",
  },
  ORDER_ALREADY_LINKED: {
    status: 409,
    message: "تم إنشاء طلب لهذا الحجز بالفعل — حدّثي التقويم",
  },
  REKAZ_LINK_UNAVAILABLE: {
    status: 503,
    message: "ترقية قاعدة البيانات غير مطبّقة بعد — تعذّر ربط الحجز بالطلب",
  },
};

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return mobileError(400, "INVALID_JSON", "A JSON object is required");
  }
  const reservationId =
    typeof body.reservationId === "string" ? body.reservationId.trim() : "";
  if (!reservationId) {
    return mobileError(400, "RESERVATION_REQUIRED", "reservationId is required");
  }

  try {
    const order = await createBookingFromReservation(
      auth.session.userId,
      reservationId,
    );
    return mobileData({ order }, 201);
  } catch (error) {
    if (error instanceof RekazBookingError) {
      const mapped = ERROR_STATUS[error.code];
      return mobileError(mapped.status, error.code, mapped.message);
    }
    return mobileServerError(
      error,
      "RESERVATION_ORDER_FAILED",
      "تعذّر إنشاء الطلب من حجز ركاز",
    );
  }
}
