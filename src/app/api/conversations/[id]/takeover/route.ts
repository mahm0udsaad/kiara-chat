import { NextResponse } from "next/server";

import { denyIfRouted } from "@/lib/conversation-access";
import { takeOverConversation, TakeoverError } from "@/lib/interactions";
import { getKiaraSession } from "@/lib/tenant";

/**
 * POST /api/conversations/:id/takeover — the web half of the admin override.
 *
 * Same command as the mobile route, so a takeover recorded from a laptop and
 * one recorded from a phone produce the identical event.
 */
const ERROR_STATUS: Record<string, { status: number; message: string }> = {
  TAKEOVER_ADMIN_ONLY: {
    status: 403,
    message: "استلام محادثة موظفة أخرى متاح للإدارة فقط",
  },
  TAKEOVER_REASON_REQUIRED: {
    status: 400,
    message: "يجب كتابة سبب الاستلام (٣ أحرف على الأقل)",
  },
  TAKEOVER_NOT_NEEDED: {
    status: 409,
    message: "المحادثة غير مسندة لموظفة أخرى — استخدمي استلام المحادثة",
  },
  TAKEOVER_AUDIT_FAILED: {
    status: 500,
    message: "تم نقل المحادثة لكن تعذّر تسجيل السبب — أبلغي المسؤول",
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
    const { previousAssignee } = await takeOverConversation({
      conversationId: id,
      session,
      reason,
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
