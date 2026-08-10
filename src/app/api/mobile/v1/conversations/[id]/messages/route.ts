import { getConversationById, getConversationMessages, MESSAGE_PAGE_SIZE } from "@/lib/inbox";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
  parseIntegerParam,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

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

    const url = new URL(request.url);
    const limit = parseIntegerParam(
      url.searchParams.get("limit"),
      MESSAGE_PAGE_SIZE,
      1,
      100
    );
    const before = url.searchParams.get("before");
    if (before && !Number.isFinite(Date.parse(before))) {
      return mobileError(400, "INVALID_CURSOR", "before must be an ISO date");
    }

    const page = await getConversationMessages(id, { limit, before });
    return mobileData({
      conversationId: id,
      messages: page.messages,
      hasMore: page.hasMore,
      nextBefore: page.hasMore ? page.messages[0]?.created_at ?? null : null,
    });
  } catch (error) {
    return mobileServerError(
      error,
      "MESSAGES_FAILED",
      "Unable to load messages"
    );
  }
}
