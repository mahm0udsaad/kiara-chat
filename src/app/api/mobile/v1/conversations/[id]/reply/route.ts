import { getConversationById } from "@/lib/inbox";
import { sendReply } from "@/lib/interactions";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

const MAX_REPLY_LENGTH = 4_096;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload: unknown = await request.json().catch(() => null);
  const body =
    payload && typeof payload === "object" && "body" in payload
      ? (payload as { body?: unknown }).body
      : null;
  if (typeof body !== "string" || !body.trim()) {
    return mobileError(400, "EMPTY_REPLY", "body must be a non-empty string");
  }
  const text = body.trim();
  if (text.length > MAX_REPLY_LENGTH) {
    return mobileError(
      400,
      "REPLY_TOO_LONG",
      `body cannot exceed ${MAX_REPLY_LENGTH} characters`
    );
  }

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
    if (
      auth.session.role !== "admin" &&
      conversation.assigned_to !== auth.session.teamMemberId
    ) {
      return mobileError(
        conversation.assigned_to ? 403 : 409,
        conversation.assigned_to
          ? "CONVERSATION_ASSIGNED_TO_ANOTHER_EMPLOYEE"
          : "CONVERSATION_NOT_TAKEN",
        conversation.assigned_to
          ? "Only the assigned employee can reply"
          : "Take the conversation before replying"
      );
    }

    const result = await sendReply(
      id,
      {
        email: auth.session.email,
        teamMemberId: auth.session.teamMemberId,
      },
      text
    );
    return mobileData(
      {
        conversationId: id,
        messageId: result.messageId,
        deliveryStatus: result.sent ? "sent" : "queued",
      },
      202
    );
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_REPLY_FAILED",
      "Unable to send the reply"
    );
  }
}
