import {
  getOrderPunctuality,
  LATE_REASON_CODES,
  recordDriverLocation,
  submitLateReason,
  TRACKING_STOP_CODES,
  type LateReasonCode,
} from "@/lib/punctuality";
import { getFieldOrder } from "@/lib/field-staff";
import {
  authorizeFieldStaffRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

async function assigned(
  request: Request,
  params: Promise<{ id: string }>,
) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return { response: auth.response } as const;
  const { id } = await params;
  const order = await getFieldOrder(auth.session, id);
  if (!order) return { response: mobileError(404, "FIELD_ORDER_NOT_FOUND", "Order not found") } as const;
  return { session: auth.session, id } as const;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await assigned(request, params);
  if (auth.response) return auth.response;
  try {
    return mobileData({ punctuality: await getOrderPunctuality(auth.id) });
  } catch (error) {
    return mobileServerError(error, "PUNCTUALITY_FAILED", "Unable to load punctuality details");
  }
}

/** One GPS fix from the assigned driver while this trip is active. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await assigned(request, params);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  try {
    const punctuality = await recordDriverLocation(auth.session, auth.id, {
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      accuracyMeters: Number(body.accuracyMeters),
      capturedAt: String(body.capturedAt ?? ""),
      speedMps: body.speedMps == null ? undefined : Number(body.speedMps),
    });
    return mobileData({ punctuality });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    // 409s tell the phone to stop its trip service for this order.
    if ((TRACKING_STOP_CODES as readonly string[]).includes(code)) return mobileError(409, code, code);
    if (code === "DRIVER_REQUIRED" || code === "FIELD_ORDER_FORBIDDEN") return mobileError(403, code, code);
    if (code === "LOCATION_SAMPLE_INVALID") return mobileError(422, code, code);
    return mobileServerError(error, "LOCATION_SAMPLE_FAILED", "Unable to save driver location");
  }
}

/** Assigned driver/specialist supplies the structured explanation once late. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await assigned(request, params);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const code = String(body.code ?? "") as LateReasonCode;
  const note = String(body.note ?? "").trim();
  if (!LATE_REASON_CODES.includes(code) || note.length < 3 || note.length > 500) {
    return mobileError(400, "LATE_REASON_INVALID", "A structured reason and 3–500 character note are required");
  }
  try {
    return mobileData({ punctuality: await submitLateReason({
      orderId: auth.id,
      actorUserId: auth.session.userId,
      code,
      note,
    }) });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_LATE") {
      return mobileError(409, "ORDER_NOT_LATE", "This visit is not currently classified as late");
    }
    return mobileServerError(error, "LATE_REASON_FAILED", "Unable to save the late reason");
  }
}
