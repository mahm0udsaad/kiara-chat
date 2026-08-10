import { getConversationById } from "@/lib/inbox";
import { markConversationRead } from "@/lib/interactions";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export async function POST(
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
    await markConversationRead(id);
    return mobileData({ conversationId: id, unreadCount: 0 });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_READ_FAILED",
      "Unable to mark the conversation as read"
    );
  }
}
