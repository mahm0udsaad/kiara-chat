import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import { sendReply } from "@/lib/interactions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;

  // The same assignment rule the mobile contract enforces. Web used to skip it
  // entirely, so an admin could reply into another employee's thread — and an
  // agent could reply into an unclaimed one — without any record of it.
  const conversation = await getConversationById(id, {
    isAdmin: session.role === "admin",
    teamMemberId: session.teamMemberId,
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  const denial = replyDenialFor(conversation, {
    role: session.role,
    teamMemberId: session.teamMemberId,
  });
  if (denial) {
    return NextResponse.json(
      { error: denial.message, code: denial.code, assignedTo: denial.assignedTo },
      { status: denial.status },
    );
  }

  const body = await request.json().catch(() => ({}));
  const text = (body?.body as string | undefined)?.trim();
  if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  try {
    const teamMemberId = session.teamMemberId;
    const result = await sendReply(id, { email: session.email, teamMemberId }, text);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 }
    );
  }
}
