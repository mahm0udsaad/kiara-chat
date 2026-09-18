import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { clearConversationMessages } from "@/lib/inbox";
import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";

/**
 * POST /api/conversations/[id]/clear — hide the whole thread from Kiara's own
 * view (nothing changes on WhatsApp — see `clearConversationMessages`).
 * Owner-only: it reads as wiping a customer's history, and an employee has
 * `messages/[messageId]` DELETE for a single mistaken send.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await clearConversationMessages(id);
    await recordConversationEvent(id, CONVERSATION_EVENTS.messagesCleared, {
      userId: session.userId,
      teamMemberId: session.teamMemberId,
      role: session.role,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر مسح المحادثة" },
      { status: 500 }
    );
  }
}
