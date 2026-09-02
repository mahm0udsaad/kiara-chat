import {
  dispatchBooking,
  orderExists,
  type DispatchBookingInput,
} from "@/lib/dispatch";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { orderForMobileSession } from "@/lib/mobile/orders";
import { OperationalCommandError } from "@/lib/operational-commands";

export const runtime = "nodejs";
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A recording longer than this is a phone call, not a note — same cap as web. */
const MAX_VOICE_BYTES = 8 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  // A written dispatch is JSON. One carrying a recorded note for the specialist
  // is multipart, so the audio streams up as bytes instead of being inflated to
  // base64 by the phone — the same split the web dialog makes.
  const multipart = (request.headers.get("content-type") ?? "").includes(
    "multipart/form-data",
  );
  let body: Record<string, unknown>;
  let specialistVoice: DispatchBookingInput["specialistVoice"];
  if (multipart) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return mobileError(400, "INVALID_FORM", "Invalid multipart body");
    }
    body = Object.fromEntries(
      [...form.entries()].filter(([, value]) => typeof value === "string"),
    );
    const voice = form.get("specialistVoice");
    if (voice instanceof File && voice.size > 0) {
      if (voice.size > MAX_VOICE_BYTES) {
        return mobileError(
          413,
          "VOICE_NOTE_TOO_LARGE",
          "The voice note is too long",
        );
      }
      specialistVoice = {
        base64: Buffer.from(await voice.arrayBuffer()).toString("base64"),
        contentType: voice.type || "audio/mp4",
        filename: voice.name || "note.m4a",
      };
    }
  } else {
    const payload: unknown = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return mobileError(400, "INVALID_JSON", "A JSON object is required");
    }
    body = payload as Record<string, unknown>;
  }
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
    if (!(await orderExists(id))) {
      return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    const result = await dispatchBooking(id, {
      specialistId,
      driverId,
      driverMessage,
      specialistMessage,
      specialistVoice,
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
      // Kept for builds that still read them: an app-only dispatch is complete
      // the moment it is stored, so both are true. `notified` is the one that
      // can fail, and it is only the push.
      driverSent: result.sent,
      specialistSent: result.specialistSent,
      notified: result.notified,
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
