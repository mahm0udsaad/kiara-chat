import { getConversationById } from "@/lib/inbox";
import { takeOverConversation, TakeoverError } from "@/lib/interactions";
import { toClassifiedMobileConversation } from "@/lib/mobile/conversations";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

/**
 * POST /api/mobile/v1/conversations/:id/takeover — employee rescue, on record.
 *
 * Distinct from `/take`, which is the ordinary first-claim of an unassigned
 * conversation. This one moves a thread away from the employee holding it.
 * Every active employee may do that, but the reason is mandatory and becomes
 * part of the `conversation.taken_over` audit event.
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
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload = await request.json().catch(() => null);
  const reason =
    payload && typeof payload === "object" && "reason" in payload
      ? String((payload as { reason?: unknown }).reason ?? "")
      : "";

  const { id } = await params;
  const viewer = {
    isAdmin: auth.session.role === "admin",
    teamMemberId: auth.session.teamMemberId,
  };

  try {
    const existing = await getConversationById(id, viewer);
    if (!existing) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }

    const { previousAssignee } = await takeOverConversation({
      conversationId: id,
      session: auth.session,
      reason,
      expectedAssignee: existing.assigned_to as string,
    });

    const updated = await getConversationById(id, viewer);
    if (!updated) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    return mobileData({
      conversation: await toClassifiedMobileConversation(updated),
      previousAssignee,
    });
  } catch (error) {
    if (error instanceof TakeoverError) {
      const mapped = ERROR_STATUS[error.code];
      return mobileError(mapped.status, error.code, mapped.message);
    }
    return mobileServerError(
      error,
      "CONVERSATION_TAKEOVER_FAILED",
      "تعذّر استلام المحادثة",
    );
  }
}
