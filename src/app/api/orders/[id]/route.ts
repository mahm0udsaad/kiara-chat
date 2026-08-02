import { NextResponse } from "next/server";
import { denyIfRouted } from "@/lib/conversation-access";
import {
  getOrderConversationId,
  updateDriverOrder,
  type OrderPatch,
} from "@/lib/dispatch";
import { getKiaraSession } from "@/lib/tenant";
import type { TripType } from "@/lib/types";

const TRIP_TYPES: TripType[] = ["one_way", "round_trip"];
const MIN_MINUTES = 5;
const MAX_MINUTES = 8 * 60;

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
    const conversationId = await getOrderConversationId(id);
    if (!conversationId) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }
    const denied = await denyIfRouted(conversationId, session);
    if (denied) return denied;

    const order = await updateDriverOrder(id, patch, session.teamMemberId);
    return NextResponse.json({
      ok: true,
      order: session.role === "admin" ? order : { ...order, price: null },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر حفظ التعديل" },
      { status: 500 }
    );
  }
}
