import { NextResponse } from "next/server";
import { isBookingStage } from "@/lib/booking-stage";
import { denyIfRouted } from "@/lib/conversation-access";
import { setBookingStage } from "@/lib/interactions";
import { getKiaraSession } from "@/lib/tenant";

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
  if (!isBookingStage(body?.stage)) {
    return NextResponse.json({ error: "مرحلة الحجز غير صحيحة" }, { status: 400 });
  }

  try {
    await setBookingStage(id, body.stage);
    return NextResponse.json({ ok: true, stage: body.stage });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "تعذّر تحديث مرحلة الحجز",
      },
      { status: 500 }
    );
  }
}
