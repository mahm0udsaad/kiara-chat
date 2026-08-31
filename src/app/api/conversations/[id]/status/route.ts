import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { setCsStatus, type CsStatus } from "@/lib/interactions";
import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";
import { conversationCsStatus } from "@/lib/mobile/conversations";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Conversation } from "@/lib/types";

const VALID: CsStatus[] = ["open", "waiting", "resolved"];

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
  const status = body?.status as CsStatus | undefined;
  if (!status || !VALID.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  // Read the status being replaced before replacing it: "moved to resolved"
  // is a fact about a change, and the row alone can only ever show the end of
  // one.
  const { data: before } = await getAdminSupabaseClient()
    .from("conversations")
    .select("metadata, status")
    .eq("id", id)
    .maybeSingle();
  const previous = before
    ? conversationCsStatus({
        metadata: before.metadata,
        status: before.status as Conversation["status"],
      })
    : null;
  await setCsStatus(id, status);
  if (previous !== status) {
    await recordConversationEvent(
      id,
      CONVERSATION_EVENTS.statusChanged,
      {
        userId: session.userId,
        teamMemberId: session.teamMemberId,
        role: session.role,
      },
      { from: previous, to: status },
    );
  }
  return NextResponse.json({ ok: true, status });
}
