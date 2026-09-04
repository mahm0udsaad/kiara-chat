import { NextResponse } from "next/server";

import { denyIfRouted } from "@/lib/conversation-access";
import { getConversationById } from "@/lib/inbox";
import { takeOverConversation, TakeoverError } from "@/lib/interactions";
import { getKiaraSession } from "@/lib/tenant";

/**
 * POST /api/conversations/:id/takeover — the web half of employee takeover.
 *
 * Same command as the mobile route, so a takeover recorded from a laptop and
 * one recorded from a phone produce the identical event.
 */
const ERROR_STATUS: Record<string, { status: number; message: string }> = {
  TAKEOVER_MEMBER_REQUIRED: {
    status: 403,
    message: "يجب أن يكون الحساب مرتبطًا بعضوية فريق نشطة",
  },
  TAKEOVER_REASON_REQUIRED: {
    status: 400,
    message: "يجب كتابة سبب الاستلام (٣ أحرف على الأقل)",
  },
  TAKEOVER_NOT_NEEDED: {
    status: 409,
    message: "المحادثة غير مسندة لموظفة أخرى — استخدمي استلام المحادثة",
  },
  TAKEOVER_OWNER_CHANGED: {
    status: 409,
    message: "استلمت موظفة أخرى المحادثة للتو — أعيدي فتحها للتأكد",
  },
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : "";

  try {
    const existing = await getConversationById(id, {
      isAdmin: session.role === "admin",
      teamMemberId: session.teamMemberId,
    });
    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (!existing.assigned_to) {
      return NextResponse.json(
        { error: ERROR_STATUS.TAKEOVER_NOT_NEEDED.message, code: "TAKEOVER_NOT_NEEDED" },
        { status: ERROR_STATUS.TAKEOVER_NOT_NEEDED.status },
      );
    }

    const { previousAssignee } = await takeOverConversation({
      conversationId: id,
      session,
      reason,
      expectedAssignee: existing.assigned_to,
    });
    return NextResponse.json({ ok: true, previousAssignee });
  } catch (error) {
    if (error instanceof TakeoverError) {
      const mapped = ERROR_STATUS[error.code];
      return NextResponse.json(
        { error: mapped.message, code: error.code },
        { status: mapped.status },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر استلام المحادثة" },
      { status: 500 },
    );
  }
}
