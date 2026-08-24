import {
  getFieldOrder,
  updateFieldOrder,
  type FieldOrderAction,
} from "@/lib/field-staff";
import { notifyFieldDriverArrived, notifyNextFieldStep } from "@/lib/field-push";
import {
  authorizeFieldStaffRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { OperationalCommandError } from "@/lib/operational-commands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIONS = new Set<FieldOrderAction>([
  "confirm_ride",
  "driver_arrived",
  "confirm_pickup",
  "start_service",
  "complete_order",
  "driver_return",
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const order = await getFieldOrder(auth.session, id);
    if (!order) return mobileError(404, "FIELD_ORDER_NOT_FOUND", "Order not found");
    return mobileData({ order });
  } catch (error) {
    return mobileServerError(error, "FIELD_ORDER_FAILED", "Unable to load the order");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const action = body?.action as FieldOrderAction;
  if (!ACTIONS.has(action)) {
    return mobileError(400, "INVALID_FIELD_ACTION", "Unsupported order action");
  }
  const expectedVersion = Number(body?.expectedVersion);
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return mobileError(
      400,
      "EXPECTED_VERSION_REQUIRED",
      "expectedVersion must be a positive integer",
    );
  }
  if (!UUID.test(idempotencyKey)) {
    return mobileError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "idempotencyKey must be a UUID",
    );
  }
  const { id } = await params;
  try {
    const order = await updateFieldOrder(auth.session, id, action, {
      expectedVersion,
      idempotencyKey,
      location:
        body?.location && typeof body.location === "object"
          ? body.location
          : null,
    });
    try {
      if (action === "driver_arrived") {
        // A side ping, not a step advance: tell the specialist her ride is here
        // rather than nudging her with the generic next-step reminder.
        const delivery = await notifyFieldDriverArrived({
          orderId: order.id,
          specialistId: order.specialistId,
          customerName: order.customerName,
        });
        if (delivery.failed) {
          console.error("[field-push] Driver-arrival notification failed", delivery);
        }
      } else {
        const delivery = await notifyNextFieldStep({
          orderId: order.id,
          specialistId: order.specialistId,
          driverId: order.driverId,
          progress: order.progress,
        });
        if (delivery.failed) {
          console.error("[field-push] Next-step notification failed", delivery);
        }
      }
    } catch (pushError) {
      // The operational step is already committed. Never turn a transient push
      // outage into a retry of the action itself.
      console.error("[field-push] Unable to send field notification", pushError);
    }
    return mobileData({ order });
  } catch (error) {
    if (error instanceof OperationalCommandError && error.isConflict) {
      return mobileError(
        409,
        error.code,
        "The order changed or this step was already completed. Refresh before continuing.",
      );
    }
    if (error instanceof Error && error.message.includes("غير متاحة")) {
      return mobileError(409, "FIELD_ACTION_OUT_OF_SEQUENCE", error.message);
    }
    return mobileServerError(error, "FIELD_ACTION_FAILED", "Unable to save the order step");
  }
}
