import { NextResponse } from "next/server";
import {
  cancelDriverOrder,
  orderExists,
  updateDriverOrder,
  type OrderPatch,
} from "@/lib/dispatch";
import { getKiaraSession } from "@/lib/tenant";
import { OperationalCommandError } from "@/lib/operational-commands";
import type { TripType } from "@/lib/types";

const TRIP_TYPES: TripType[] = ["one_way", "round_trip"];
const MIN_MINUTES = 5;
const MAX_MINUTES = 8 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/orders/[id] — edit a saved order from the details sheet.
 *
 * Any member may fix the details of a chat they can see; the driver's fare is
 * owner/manager-only, the same split the rest of the orders page uses.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const patch: OrderPatch = {};
  const expectedVersion = Number(body?.expectedVersion);
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return NextResponse.json(
      { error: "حدّثي الطلب ثم أعيدي المحاولة" },
      { status: 400 },
    );
  }
  if (!UUID.test(idempotencyKey)) {
    return NextResponse.json(
      { error: "معرّف العملية غير صحيح" },
      { status: 400 },
    );
  }

  if (body?.arrivalAt !== undefined) {
    const arrival = new Date(String(body.arrivalAt));
    if (Number.isNaN(arrival.getTime())) {
      return NextResponse.json({ error: "موعد الوصول غير صحيح" }, { status: 400 });
    }
    patch.arrivalAt = arrival.toISOString();
  }
  if (body?.customerLocation !== undefined) {
    const location = String(body.customerLocation).trim();
    if (!location) {
      return NextResponse.json({ error: "موقع الزبونة مطلوب" }, { status: 400 });
    }
    patch.customerLocation = location;
  }
  if (body?.durationMinutes !== undefined) {
    const minutes = Number(body.durationMinutes);
    if (!Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      return NextResponse.json({ error: "مدة الجلسة غير صحيحة" }, { status: 400 });
    }
    patch.durationMinutes = Math.round(minutes);
  }
  if (body?.tripType !== undefined) {
    if (!TRIP_TYPES.includes(body.tripType as TripType)) {
      return NextResponse.json({ error: "نوع الرحلة غير صحيح" }, { status: 400 });
    }
    patch.tripType = body.tripType as TripType;
  }
  if (body?.specialistId !== undefined) {
    patch.specialistId = (String(body.specialistId ?? "").trim() || null) as string | null;
  }
  if (body?.driverId !== undefined) {
    patch.driverId = (String(body.driverId ?? "").trim() || null) as string | null;
  }
  if (body?.price !== undefined) {
    if (session.role !== "admin") {
      return NextResponse.json({ error: "الأجرة للمالك أو المدير فقط" }, { status: 403 });
    }
    const price = body.price === null || body.price === "" ? null : Number(body.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return NextResponse.json({ error: "الأجرة غير صحيحة" }, { status: 400 });
    }
    patch.price = price;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "لا يوجد تعديل" }, { status: 400 });
  }

  try {
    // Any employee may act on any order: the schedule is shared work, and the
    // inbox's exclusive routing governs reading a chat, not dispatching a car.
    if (!(await orderExists(id))) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }

    const order = await updateDriverOrder(id, patch, {
      expectedVersion,
      idempotencyKey,
      actor: {
        userId: session.userId,
        teamMemberId: session.teamMemberId,
        role: session.role,
      },
    });
    return NextResponse.json({
      ok: true,
      order: session.role === "admin" ? order : { ...order, price: null },
    });
  } catch (error) {
    if (error instanceof OperationalCommandError && error.isConflict) {
      return NextResponse.json(
        {
          error: "عدّلت موظفة أخرى الطلب. تم إيقاف الحفظ لحماية بياناتها؛ حدّثي الطلب وراجعي التغيير.",
          code: error.code,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر حفظ التعديل" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    if (!(await orderExists(id))) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }

    const order = await cancelDriverOrder(id, {
      actor: {
        userId: session.userId,
        teamMemberId: session.teamMemberId,
        role: session.role,
      },
    });

    return NextResponse.json({
      ok: true,
      order: session.role === "admin" ? order : { ...order, price: null },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر إلغاء الطلب" },
      { status: 500 },
    );
  }
}
