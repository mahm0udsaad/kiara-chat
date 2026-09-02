import { orderExists, previewBookingDispatch } from "@/lib/dispatch";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import type { TripType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return mobileError(400, "INVALID_JSON", "A JSON object is required");
  }
  const specialistId =
    typeof body.specialistId === "string" ? body.specialistId.trim() : "";
  const driverId = typeof body.driverId === "string" ? body.driverId.trim() : "";
  const specialistNote =
    typeof body.specialistNote === "string" ? body.specialistNote.trim() : "";
  // The preview must quote the address that is about to be committed, not the
  // one stored before the employee corrected it.
  const customerLocation =
    typeof body.customerLocation === "string"
      ? body.customerLocation.trim().slice(0, 500)
      : "";
  const tripType: TripType | undefined =
    body.tripType === "one_way" || body.tripType === "round_trip"
      ? body.tripType
      : undefined;

  if (!specialistId) {
    return mobileError(400, "SPECIALIST_REQUIRED", "specialistId is required");
  }
  if (!driverId) {
    return mobileError(400, "DRIVER_REQUIRED", "driverId is required");
  }
  // Deliberately optional: when the employee records her instructions instead
  // of typing them there is no note to send, and the booking copy the preview
  // builds stands on its own.
  if (specialistNote.length > 500) {
    return mobileError(
      400,
      "SPECIALIST_NOTE_TOO_LONG",
      "specialistNote cannot exceed 500 characters",
    );
  }

  const { id } = await params;
  try {
    if (!(await orderExists(id))) {
      return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    }
    const preview = await previewBookingDispatch(id, {
      specialistId,
      driverId,
      customerLocation,
      specialistNote,
      tripType,
    });
    return mobileData({ preview });
  } catch (error) {
    // Building a preview for an order that already went out is not a server
    // fault — it is the app's answer to an employee opening dispatch twice,
    // and it has to carry the code the screen keys its message off. A 500 with
    // English prose left her staring at a form that could never be sent.
    if (error instanceof Error && error.message.includes("تم إرسال هذا الطلب بالفعل")) {
      return mobileError(409, "ORDER_ALREADY_DISPATCHED", "The order was already dispatched");
    }
    return mobileServerError(
      error,
      "DISPATCH_PREVIEW_FAILED",
      "Unable to prepare the final messages",
    );
  }
}
