import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { releaseConversation } from "@/lib/interactions";
import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;
  await releaseConversation(id);
  await recordConversationEvent(id, CONVERSATION_EVENTS.released, {
    userId: session.userId,
    teamMemberId: session.teamMemberId,
    role: session.role,
  });
  return NextResponse.json({ ok: true });
}
