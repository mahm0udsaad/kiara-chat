import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import { sendReply } from "@/lib/interactions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

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
    let replyTo: { id: string; role: string; text: string; message_type: string; external_message_sid: string | null } | undefined;
    if (typeof body?.replyToMessageId === "string") {
      const admin = getAdminSupabaseClient();
      const { data: referenced } = await admin
        .from("messages")
        .select("id, role, content, message_type, external_message_sid")
        .eq("id", body.replyToMessageId)
        .eq("conversation_id", id)
        .maybeSingle();
      if (!referenced) return NextResponse.json({ error: "رسالة الرد غير موجودة" }, { status: 400 });
      replyTo = {
        id: referenced.id as string,
        role: referenced.role as string,
        text: (referenced.content as string | null) ?? "",
        message_type: referenced.message_type as string,
        external_message_sid: (referenced.external_message_sid as string | null) ?? null,
      };
    }
    const teamMemberId = session.teamMemberId;
    const clientRequestId = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : undefined;
    const result = await sendReply(id, { email: session.email, teamMemberId }, text, clientRequestId, replyTo);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send" },
      { status: 500 }
    );
  }
}
