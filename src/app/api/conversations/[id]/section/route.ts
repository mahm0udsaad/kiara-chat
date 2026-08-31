import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { setConversationSection } from "@/lib/interactions";
import { isConversationSection } from "@/lib/conversation-meta";
import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";

/** Owner-only: file the chat under قسم الطلبات / قسم الردود (or clear it). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const raw = body?.section;
  if (raw != null && !isConversationSection(raw))
    return NextResponse.json({ error: "قسم غير معروف" }, { status: 400 });

  try {
    const conversation = await setConversationSection(id, raw ?? null);
    await recordConversationEvent(
      id,
      CONVERSATION_EVENTS.sectionChanged,
      {
        userId: session.userId,
        teamMemberId: session.teamMemberId,
        role: session.role,
      },
      { to: raw ?? null },
    );
    return NextResponse.json({ ok: true, conversation });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر تحديد القسم" },
      { status: 500 }
    );
  }
}
