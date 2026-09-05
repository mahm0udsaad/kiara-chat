import {
  cancelDriverOrder,
  listDrivers,
  listSpecialists,
  orderExists,
  updateDriverOrder,
  type OrderPatch,
} from "@/lib/dispatch";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import {
  getMobileOrderById,
  orderForMobileSession,
} from "@/lib/mobile/orders";
import { OperationalCommandError } from "@/lib/operational-commands";
import type { TripType } from "@/lib/types";

const TRIP_TYPES: TripType[] = ["one_way", "round_trip"];
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 8 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  try {
    const order = await getMobileOrderById(id, auth.session);
    if (!order) return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    return mobileData({ order });
  } catch (error) {
    return mobileServerError(
      error,
      "ORDER_DETAIL_FAILED",
      "Unable to load the order"
    );
  }
}

async function rosterIdsAreValid(patch: OrderPatch): Promise<boolean> {
  const [specialists, drivers] = await Promise.all([
    patch.specialistId
      ? listSpecialists({ activeOnly: true })
      : Promise.resolve([]),
    patch.driverId ? listDrivers({ activeOnly: true }) : Promise.resolve([]),
  ]);
  return (
    (!patch.specialistId ||
      specialists.some((item) => item.id === patch.specialistId)) &&
    (!patch.driverId || drivers.some((item) => item.id === patch.driverId))
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = bodyRecord(await request.json().catch(() => null));
  if (!body) {
    return mobileError(400, "INVALID_JSON", "A JSON object is required");
  }

  const patch: OrderPatch = {};
  const expectedVersion = Number(body.expectedVersion);
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
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

  if (body.arrivalAt !== undefined) {
    if (typeof body.arrivalAt !== "string") {
      return mobileError(400, "INVALID_ARRIVAL_AT", "arrivalAt must be an ISO date");
    }
    const arrivalAt = new Date(body.arrivalAt);
    if (Number.isNaN(arrivalAt.getTime())) {
      return mobileError(400, "INVALID_ARRIVAL_AT", "arrivalAt must be an ISO date");
    }
    patch.arrivalAt = arrivalAt.toISOString();
  }

  if (body.customerLocation !== undefined) {
    if (typeof body.customerLocation !== "string" || !body.customerLocation.trim()) {
      return mobileError(
        400,
        "INVALID_CUSTOMER_LOCATION",
        "customerLocation must be a non-empty string"
      );
    }
    patch.customerLocation = body.customerLocation.trim().slice(0, 2_000);
  }

  if (body.durationMinutes !== undefined) {
    const durationMinutes = Number(body.durationMinutes);
    if (
      !Number.isFinite(durationMinutes) ||
      durationMinutes < MIN_DURATION_MINUTES ||
      durationMinutes > MAX_DURATION_MINUTES
    ) {
      return mobileError(
        400,
        "INVALID_DURATION",
        `durationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}`
      );
    }
    patch.durationMinutes = Math.round(durationMinutes);
  }

  if (body.tripType !== undefined) {
    if (!TRIP_TYPES.includes(body.tripType as TripType)) {
      return mobileError(
        400,
        "INVALID_TRIP_TYPE",
        "tripType must be one_way or round_trip"
      );
    }
    patch.tripType = body.tripType as TripType;
  }

  if (body.specialistId !== undefined) {
    if (body.specialistId !== null && typeof body.specialistId !== "string") {
      return mobileError(
        400,
        "INVALID_SPECIALIST",
        "specialistId must be a string or null"
      );
    }
    patch.specialistId =
      typeof body.specialistId === "string"
        ? body.specialistId.trim() || null
        : null;
  }

  if (body.driverId !== undefined) {
    if (body.driverId !== null && typeof body.driverId !== "string") {
      return mobileError(
        400,
        "INVALID_DRIVER",
        "driverId must be a string or null"
      );
    }
    patch.driverId =
      typeof body.driverId === "string" ? body.driverId.trim() || null : null;
  }

  if (body.price !== undefined) {
    if (auth.session.role !== "admin") {
      return mobileError(
        403,
        "PRICE_FORBIDDEN",
        "Only an admin can edit the driver price"
      );
    }
    const price =
      body.price === null || body.price === "" ? null : Number(body.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return mobileError(400, "INVALID_PRICE", "price must be zero or greater");
    }
    patch.price = price;
  }

  if (!Object.keys(patch).length) {
    return mobileError(400, "EMPTY_ORDER_PATCH", "No supported fields were provided");
  }

  const { id } = await params;
  try {
    if (!(await orderExists(id))) {
      return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    }
    if (!(await rosterIdsAreValid(patch))) {
      return mobileError(
        400,
        "INVALID_ROSTER_SELECTION",
        "The specialist or driver is not an active Kiara team member"
      );
    }

    const order = await updateDriverOrder(
      id,
      patch,
      {
        expectedVersion,
        idempotencyKey,
        actor: {
          userId: auth.session.userId,
          teamMemberId: auth.session.teamMemberId,
          role: auth.session.role,
        },
      },
    );
    return mobileData({
      order: orderForMobileSession(order, auth.session),
    });
  } catch (error) {
    if (error instanceof OperationalCommandError && error.isConflict) {
      return mobileError(
        409,
        error.code,
        "The order changed while you were editing. Refresh and review the latest details.",
      );
    }
    return mobileServerError(
      error,
      "ORDER_UPDATE_FAILED",
      "Unable to update the order"
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  try {
    if (!(await orderExists(id))) {
      return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    const order = await cancelDriverOrder(id, {
      actor: {
        userId: auth.session.userId,
        teamMemberId: auth.session.teamMemberId,
        role: auth.session.role,
      },
    });

    return mobileData({
      order: orderForMobileSession(order, auth.session),
    });
  } catch (error) {
    return mobileServerError(
      error,
      "ORDER_CANCEL_FAILED",
      "Unable to cancel the order"
    );
  }
}
