import { NextResponse } from "next/server";
import { denyIfRouted } from "@/lib/conversation-access";
import { sendReply } from "@/lib/interactions";
import {
  MAX_RESERVATION_REMINDER_LENGTH,
  isReservationFollowUpStatus,
  type ReservationFollowUpStatus,
} from "@/lib/reservation-follow-up";
import { setReservationFollowUp } from "@/lib/reservation-follow-up-server";
import { getKiaraSession } from "@/lib/tenant";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const dayKey = String(body.dayKey ?? "");
  if (!DAY_KEY.test(dayKey)) {
    return NextResponse.json({ error: "تاريخ الحجز غير صحيح" }, { status: 400 });
  }

  try {
    if (body.action === "remind") {
      const message = typeof body.message === "string" ? body.message : "";
      if (!message.trim()) {
        return NextResponse.json({ error: "نص التذكير مطلوب" }, { status: 400 });
      }
      if (message.length > MAX_RESERVATION_REMINDER_LENGTH) {
        return NextResponse.json(
          { error: "نص التذكير أطول من الحد المسموح" },
          { status: 400 }
        );
      }
      const result = await sendReply(
        id,
        { email: session.email, teamMemberId: session.teamMemberId },
        message
      );
      const followUp = await setReservationFollowUp(
        id,
        dayKey,
        "awaiting_reply",
        session.teamMemberId,
        { reminded: true }
      );
      return NextResponse.json({ ok: true, followUp, ...result });
    }

    const status = body.status as ReservationFollowUpStatus;
    if (!isReservationFollowUpStatus(status)) {
      return NextResponse.json({ error: "حالة متابعة العميلة غير صحيحة" }, { status: 400 });
    }
    const followUp = await setReservationFollowUp(
      id,
      dayKey,
      status,
      session.teamMemberId
    );
    return NextResponse.json({ ok: true, followUp });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "تعذّر تحديث متابعة العميلة",
      },
      { status: 500 }
    );
  }
}
