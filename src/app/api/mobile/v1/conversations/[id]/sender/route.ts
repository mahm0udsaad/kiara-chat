import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { changeConversationSender, getConversationSenderState } from "@/lib/whatsapp-senders";
import { parseSenderId, SenderError } from "@/lib/whatsapp-senders-core";

/**
 * GET /api/mobile/v1/conversations/:id/sender — the number this customer is
 * answered from, and whether the thread is the field team's (no choice).
 * PUT { senderAccountId } — switch it for the whole team. Same access rule as
 * replying, since it decides where her replies go.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const conversation = await getConversationById(id, {
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
    });
    if (!conversation) return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    return mobileData(await getConversationSenderState(id));
  } catch (error) {
    return mobileServerError(error, "SENDER_STATE_FAILED", "تعذّر قراءة رقم الإرسال");
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => null)) as { senderAccountId?: unknown } | null;
  const senderAccountId = parseSenderId(body?.senderAccountId);
  if (!senderAccountId) return mobileError(400, "SENDER_UNKNOWN", "رقم الإرسال غير معروف.");
  const { id } = await params;
  try {
    const conversation = await getConversationById(id, {
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
    });
    if (!conversation) return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    const denial = replyDenialFor(conversation, {
      role: auth.session.role,
      teamMemberId: auth.session.teamMemberId,
    });
    if (denial) return mobileError(denial.status, denial.code, denial.message);
    const result = await changeConversationSender({
      conversationId: id,
      senderAccountId,
      actor: {
        userId: auth.session.userId,
        teamMemberId: auth.session.teamMemberId,
        role: auth.session.role,
      },
    });
    return mobileData(result);
  } catch (error) {
    if (error instanceof SenderError) return mobileError(error.status, error.code, error.message);
    return mobileServerError(error, "SENDER_CHANGE_FAILED", "تعذّر تغيير رقم الإرسال");
  }
}
