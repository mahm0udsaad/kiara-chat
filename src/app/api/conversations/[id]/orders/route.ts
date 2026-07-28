import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { createAndDispatchOrder } from "@/lib/dispatch";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const specialistId = (body?.specialistId as string | undefined)?.trim();
  const driverId = (body?.driverId as string | undefined)?.trim();
  const arrivalAt = (body?.arrivalAt as string | undefined)?.trim();
  const customerLocation = (body?.customerLocation as string | undefined)?.trim();
  const durationMinutes = Number(body?.durationMinutes);

  if (!specialistId) return NextResponse.json({ error: "اختاري الأخصائية" }, { status: 400 });
  if (!driverId) return NextResponse.json({ error: "اختاري السائق" }, { status: 400 });
  if (!arrivalAt || Number.isNaN(Date.parse(arrivalAt)))
    return NextResponse.json({ error: "موعد الوصول غير صحيح" }, { status: 400 });
  if (!customerLocation) return NextResponse.json({ error: "موقع الزبونة مطلوب" }, { status: 400 });
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0)
    return NextResponse.json({ error: "المدة غير صحيحة" }, { status: 400 });

  try {
    const { order, sent } = await createAndDispatchOrder(session.userId, {
      conversationId: id,
      specialistId,
      driverId,
      arrivalAt,
      customerLocation,
      durationMinutes,
    });
    return NextResponse.json({ ok: true, order, sent });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر إنشاء الطلب" },
      { status: 500 }
    );
  }
}
