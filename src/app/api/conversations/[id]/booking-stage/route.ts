import { NextResponse } from "next/server";
import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";
import { bookingStageOf, isBookingStage } from "@/lib/booking-stage";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
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
    const { data: before } = await getAdminSupabaseClient()
      .from("conversations")
      .select("metadata")
      .eq("id", id)
      .maybeSingle();
    const previous = before ? bookingStageOf({ metadata: before.metadata }) : null;
    await setBookingStage(id, body.stage);
    if (previous !== body.stage) {
      await recordConversationEvent(
        id,
        CONVERSATION_EVENTS.stageChanged,
        {
          userId: session.userId,
          teamMemberId: session.teamMemberId,
          role: session.role,
        },
        { from: previous, to: body.stage },
      );
    }
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
