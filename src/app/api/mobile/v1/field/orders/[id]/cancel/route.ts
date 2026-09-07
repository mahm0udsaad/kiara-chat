import { cancelAcceptedFieldOrder } from "@/lib/field-staff";
import { notifyFieldOrderCancelled } from "@/lib/field-push";
import {
  authorizeFieldStaffRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { OperationalCommandError } from "@/lib/operational-commands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return auth.response;
  if (auth.session.role !== "driver") {
    return mobileError(403, "FIELD_CANCEL_FORBIDDEN", "Only the assigned driver can cancel this order");
  }
  const body = await request.json().catch(() => ({}));
  const expectedVersion = Number(body?.expectedVersion);
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return mobileError(400, "EXPECTED_VERSION_REQUIRED", "expectedVersion must be a positive integer");
  }
  if (!UUID.test(idempotencyKey)) {
    return mobileError(400, "IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey must be a UUID");
  }
  if (reason.length < 3 || reason.length > 500) {
    return mobileError(400, "FIELD_CANCEL_REASON_INVALID", "Cancellation reason must be 3 to 500 characters");
  }

  const { id } = await params;
  try {
    const { order, replayed } = await cancelAcceptedFieldOrder(auth.session, id, {
      expectedVersion,
      idempotencyKey,
      reason,
    });
    const customer = order.customerName || "العميلة";
    const notification = `ألغى السائق طلب ${customer}. السبب: ${reason}`;
    try {
      if (replayed) return mobileData({ order });
      const delivery = await notifyFieldOrderCancelled({
        orderId: order.id,
        customerName: order.customerName,
        specialistId: order.specialistId,
        driverId: order.driverId,
        specialistCopy: { title: "إلغاء الطلب", body: notification },
        driverCopy: { title: "إلغاء الطلب", body: notification },
      });
      if (delivery.failed) {
        console.error("[field-push] Driver cancellation notification failed", delivery);
      }
    } catch (pushError) {
      // Cancellation is committed before notification. A push outage must not
      // make the client retry the operational command.
      console.error("[field-push] Unable to send cancellation notification", pushError);
    }
    return mobileData({ order });
  } catch (error) {
    if (error instanceof OperationalCommandError && error.isConflict) {
      return mobileError(409, error.code, "The order changed and can no longer be cancelled. Refresh and try again.");
    }
    if (error instanceof Error && error.message.includes("لا يمكن إلغاء")) {
      return mobileError(409, "FIELD_CANCEL_NOT_ALLOWED", error.message);
    }
    return mobileServerError(error, "FIELD_CANCEL_FAILED", "Unable to cancel the order");
  }
}
