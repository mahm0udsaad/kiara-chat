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
  if (!specialistNote) {
    return mobileError(
      400,
      "SPECIALIST_NOTE_REQUIRED",
      "specialistNote is required",
    );
  }
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
      specialistNote,
      tripType,
    });
    return mobileData({ preview });
  } catch (error) {
    return mobileServerError(
      error,
      "DISPATCH_PREVIEW_FAILED",
      "Unable to prepare the final messages",
    );
  }
}
