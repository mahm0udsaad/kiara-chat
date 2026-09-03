/**
 * POST /api/mobile/v1/conversations/[id]/template
 *
 * Send an approved template. This is the only route that can reach a customer
 * who has not written in the last 24 hours — including one who has never
 * written at all, which is how the team starts a conversation.
 */
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import { sendTemplateReply } from "@/lib/interactions";
import { isTemplateKey } from "@/lib/templates";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload: unknown = await request.json().catch(() => null);
  const record =
    payload && typeof payload === "object"
      ? (payload as { key?: unknown; variables?: unknown })
      : {};
  if (typeof record.key !== "string" || !isTemplateKey(record.key)) {
    return mobileError(400, "UNKNOWN_TEMPLATE", "key must name a known template");
  }
  const variables =
    record.variables && typeof record.variables === "object"
      ? (record.variables as Record<string, string>)
      : {};

  const { id } = await params;
  const viewer = {
    isAdmin: auth.session.role === "admin",
    teamMemberId: auth.session.teamMemberId,
  };

  try {
    const conversation = await getConversationById(id, viewer);
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    // A template is a message like any other, so it obeys the same ownership
    // rule: an admin writing into someone else's thread takes it over first.
    const denial = replyDenialFor(conversation, {
      role: auth.session.role,
      teamMemberId: auth.session.teamMemberId,
    });
    if (denial) return mobileError(denial.status, denial.code, denial.message);

    const result = await sendTemplateReply(
      id,
      { email: auth.session.email, teamMemberId: auth.session.teamMemberId },
      record.key,
      variables,
    );
    if (!result.sent) {
      return mobileError(
        502,
        "TEMPLATE_SEND_FAILED",
        result.error ?? "تعذّر إرسال القالب",
      );
    }
    return mobileData({
      conversationId: id,
      messageId: result.messageId,
      deliveryStatus: "sent",
    });
  } catch (error) {
    return mobileServerError(
      error,
      "TEMPLATE_SEND_FAILED",
      "Unable to send the template",
    );
  }
}
