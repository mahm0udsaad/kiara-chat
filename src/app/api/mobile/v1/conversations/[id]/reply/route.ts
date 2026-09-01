import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import { sendReply } from "@/lib/interactions";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

const MAX_REPLY_LENGTH = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const idempotencyKey =
    payload && typeof payload === "object" && "idempotencyKey" in payload
      ? (payload as { idempotencyKey?: unknown }).idempotencyKey
      : null;
  if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) {
    return mobileError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must be a UUID",
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
    // Admins are not exempt. An admin replying into another employee's thread
    // gets TAKEOVER_REQUIRED and must take it over with a reason first.
    const denial = replyDenialFor(conversation, {
      role: auth.session.role,
      teamMemberId: auth.session.teamMemberId,
    });
    if (denial) {
      return mobileError(denial.status, denial.code, denial.message);
    }

    const result = await sendReply(
      id,
      {
        email: auth.session.email,
        teamMemberId: auth.session.teamMemberId,
      },
      text,
      idempotencyKey,
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
