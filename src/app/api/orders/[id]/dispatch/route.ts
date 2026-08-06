import { NextResponse } from "next/server";
import { denyIfRouted } from "@/lib/conversation-access";
import {
  dispatchBooking,
  getOrderConversationId,
  type DispatchBookingInput,
} from "@/lib/dispatch";
import { getKiaraSession } from "@/lib/tenant";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A recording longer than this is a phone call, not a note. */
const MAX_VOICE_BYTES = 8 * 1024 * 1024;

/** Assign the booking and send the specialist + driver WhatsApp copies. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // A written note comes as JSON; a recorded one needs multipart so the audio
  // streams up instead of being inflated to base64 in the browser.
  let specialistId: string | undefined;
  let driverId: string | undefined;
  let specialistNote: string | undefined;
  let specialistVoice: DispatchBookingInput["specialistVoice"];

  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }
    specialistId = (form.get("specialistId") as string | null)?.trim();
    driverId = (form.get("driverId") as string | null)?.trim();
    specialistNote = (form.get("specialistNote") as string | null)?.trim().slice(0, 500);
    const voice = form.get("specialistVoice");
    if (voice instanceof File && voice.size > 0) {
      if (voice.size > MAX_VOICE_BYTES) {
        return NextResponse.json(
          { error: "الملاحظة الصوتية أطول من اللازم" },
          { status: 413 }
        );
      }
      specialistVoice = {
        base64: Buffer.from(await voice.arrayBuffer()).toString("base64"),
        contentType: voice.type || "audio/ogg",
        filename: voice.name || "note.ogg",
      };
    }
  } else {
    const body = await request.json().catch(() => ({}));
    specialistId = (body?.specialistId as string | undefined)?.trim();
    driverId = (body?.driverId as string | undefined)?.trim();
    specialistNote = (body?.specialistNote as string | undefined)?.trim().slice(0, 500);
  }

  if (!specialistId) {
    return NextResponse.json({ error: "اختاري الأخصائية" }, { status: 400 });
  }
  if (!specialistNote && !specialistVoice) {
    return NextResponse.json(
      { error: "أضيفي رسالة مكتوبة أو صوتية للأخصائية" },
      { status: 400 }
    );
  }
  if (!driverId) {
    return NextResponse.json({ error: "اختاري السائق" }, { status: 400 });
  }

  try {
    const conversationId = await getOrderConversationId(id);
    if (!conversationId) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }
    const denied = await denyIfRouted(conversationId, session);
    if (denied) return denied;

    const result = await dispatchBooking(id, {
      specialistId,
      driverId,
      specialistNote: specialistNote || undefined,
      specialistVoice,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      order:
        session.role === "admin"
          ? result.order
          : { ...result.order, price: null },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "تعذّر إرسال طلب السائق",
      },
      { status: 500 }
    );
  }
}
