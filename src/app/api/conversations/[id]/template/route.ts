/**
 * POST /api/conversations/[id]/template
 *
 * Web counterpart of the mobile template send. Kept in step with it so the
 * dashboard and the phone cannot disagree about what the team is allowed to
 * send to a customer who has not written in the last 24 hours.
 */
import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import { sendTemplateReply } from "@/lib/interactions";
import { isTemplateKey, listSendableTemplates } from "@/lib/templates";

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ templates: listSendableTemplates() });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload: unknown = await request.json().catch(() => null);
  const record =
    payload && typeof payload === "object"
      ? (payload as { key?: unknown; variables?: unknown })
      : {};
  if (typeof record.key !== "string" || !isTemplateKey(record.key)) {
    return NextResponse.json({ error: "قالب غير معروف" }, { status: 400 });
  }
  const variables =
    record.variables && typeof record.variables === "object"
      ? (record.variables as Record<string, string>)
      : {};

  const { id } = await params;
  const viewer = {
    isAdmin: session.role === "admin",
    teamMemberId: session.teamMemberId,
  };

  try {
    const conversation = await getConversationById(id, viewer);
    if (!conversation) {
      return NextResponse.json({ error: "المحادثة غير موجودة" }, { status: 404 });
    }
    const denial = replyDenialFor(conversation, {
      role: session.role,
      teamMemberId: session.teamMemberId,
    });
    if (denial) {
      return NextResponse.json({ error: denial.message }, { status: denial.status });
    }

    const result = await sendTemplateReply(
      id,
      { email: session.email, teamMemberId: session.teamMemberId },
      record.key,
      variables,
    );
    if (!result.sent) {
      return NextResponse.json(
        { error: result.error ?? "تعذّر إرسال القالب" },
        { status: 502 },
      );
    }
    return NextResponse.json({ messageId: result.messageId, sent: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر إرسال القالب" },
      { status: 500 },
    );
  }
}
