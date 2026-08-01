import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { createBooking } from "@/lib/dispatch";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));

  const arrivalAt = (body?.arrivalAt as string | undefined)?.trim();
  const customerLocation = (body?.customerLocation as string | undefined)?.trim();
  const durationMinutes = Number(body?.durationMinutes);
  const tripType = body?.tripType === "round_trip" ? "round_trip" : "one_way";

  if (!arrivalAt || Number.isNaN(Date.parse(arrivalAt)))
    return NextResponse.json({ error: "موعد الوصول غير صحيح" }, { status: 400 });
  if (!customerLocation) return NextResponse.json({ error: "موقع الزبونة مطلوب" }, { status: 400 });
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0)
    return NextResponse.json({ error: "المدة غير صحيحة" }, { status: 400 });

  try {
    const order = await createBooking(session.userId, {
      conversationId: id,
      arrivalAt,
      customerLocation,
      durationMinutes,
      tripType,
    });
    return NextResponse.json({ ok: true, order: { ...order, price: null } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر إنشاء الطلب" },
      { status: 500 }
    );
  }
}
