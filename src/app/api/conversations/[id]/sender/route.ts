import { NextResponse } from "next/server";
import { denyIfRouted } from "@/lib/conversation-access";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import { getKiaraSession } from "@/lib/tenant";
import { changeConversationSender, getConversationSenderState } from "@/lib/whatsapp-senders";
import { parseSenderId, SenderError } from "@/lib/whatsapp-senders-core";

/** GET — this customer's reply number; PUT { senderAccountId } — switch it for the team. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;
  try {
    return NextResponse.json(await getConversationSenderState(id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "تعذّر قراءة رقم الإرسال" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const senderAccountId = parseSenderId(body?.senderAccountId);
  if (!senderAccountId) {
    return NextResponse.json({ error: "رقم الإرسال غير معروف.", code: "SENDER_UNKNOWN" }, { status: 400 });
  }
  try {
    const conversation = await getConversationById(id, {
      isAdmin: session.role === "admin",
      teamMemberId: session.teamMemberId,
    });
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    const denial = replyDenialFor(conversation, { role: session.role, teamMemberId: session.teamMemberId });
    if (denial) {
      return NextResponse.json({ error: denial.message, code: denial.code }, { status: denial.status });
    }
    const result = await changeConversationSender({
      conversationId: id,
      senderAccountId,
      actor: { userId: session.userId, teamMemberId: session.teamMemberId, role: session.role },
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SenderError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "تعذّر تغيير رقم الإرسال" }, { status: 500 });
  }
}
