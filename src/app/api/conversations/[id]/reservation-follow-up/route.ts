import { NextResponse } from "next/server";
import { denyIfRouted } from "@/lib/conversation-access";
import { sendReply } from "@/lib/interactions";
import {
  isReservationFollowUpStatus,
  type ReservationFollowUpStatus,
} from "@/lib/reservation-follow-up";
import { setReservationFollowUp } from "@/lib/reservation-follow-up-server";
import { getKiaraSession } from "@/lib/tenant";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function reminderMessage(body: Record<string, unknown>): string | null {
  const customerName = String(body.customerName ?? "").trim().slice(0, 80);
  const arrival = new Date(String(body.arrivalAt ?? ""));
  const services = Array.isArray(body.services)
    ? body.services
        .map((service) => String(service).trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  if (Number.isNaN(arrival.getTime()) || !services.length) return null;

  const day = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Riyadh",
  }).format(arrival);
  const time = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(arrival);
  return [
    `مرحبًا ${customerName || "عميلتنا"}،`,
    `نذكّرك بموعدك ${day} الساعة ${time} لخدمة ${services.join("، ")}.`,
    "فضلاً أكدي حضورك، أو أخبرينا الآن إذا رغبتِ بإلغاء الحجز قبل انطلاق السائق.",
  ].join("\n");
}

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
      const message = reminderMessage(body);
      if (!message) {
        return NextResponse.json({ error: "بيانات التذكير غير مكتملة" }, { status: 400 });
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
