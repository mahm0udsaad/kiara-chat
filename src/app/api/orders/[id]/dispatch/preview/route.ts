import { NextResponse } from "next/server";

import { denyIfRouted } from "@/lib/conversation-access";
import { getOrderConversationId, previewBookingDispatch } from "@/lib/dispatch";
import { getKiaraSession } from "@/lib/tenant";
import type { TripType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "البيانات غير صحيحة" }, { status: 400 });
  }
  const specialistId = String(body.specialistId ?? "").trim();
  const driverId = String(body.driverId ?? "").trim();
  const specialistNote = String(body.specialistNote ?? "").trim().slice(0, 500);
  const driverMessage = String(body.driverMessage ?? "").trim().slice(0, 3_000);
  const tripType: TripType | undefined =
    body.tripType === "one_way" || body.tripType === "round_trip"
      ? body.tripType
      : undefined;
  if (!specialistId || !driverId || !driverMessage) {
    return NextResponse.json(
      { error: "اختاري الأخصائية والسائق وراجعي رسالة السائق" },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    const conversationId = await getOrderConversationId(id);
    if (!conversationId) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }
    const denied = await denyIfRouted(conversationId, session);
    if (denied) return denied;

    const preview = await previewBookingDispatch(id, {
      specialistId,
      driverId,
      specialistNote,
      driverMessage,
      tripType,
    });
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر تجهيز الرسائل" },
      { status: 500 },
    );
  }
}
