import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { hideMessage } from "@/lib/inbox";
import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";

/**
 * DELETE /api/conversations/[id]/messages/[messageId] — hide one message from
 * Kiara's own thread view. See `hideMessage` in `@/lib/inbox` for what this
 * does and, importantly, does not do (nothing changes on WhatsApp itself).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, messageId } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;

  try {
    const found = await hideMessage(id, messageId, session.email ?? null);
    if (!found) {
      return NextResponse.json({ error: "الرسالة غير موجودة" }, { status: 404 });
    }
    await recordConversationEvent(id, CONVERSATION_EVENTS.messageDeleted, {
      userId: session.userId,
      teamMemberId: session.teamMemberId,
      role: session.role,
    }, { messageId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر حذف الرسالة" },
      { status: 500 }
    );
  }
}
