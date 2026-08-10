import { getConversationById } from "@/lib/inbox";
import { takeConversation } from "@/lib/interactions";
import { toMobileConversation } from "@/lib/mobile/conversations";
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

  const teamMemberId = auth.session.teamMemberId;
  if (!teamMemberId) {
    return mobileError(
      403,
      "TEAM_MEMBER_REQUIRED",
      "This account cannot take conversations"
    );
  }

  const { id } = await params;
  const viewer = {
    isAdmin: auth.session.role === "admin",
    teamMemberId,
  };

  try {
    const existing = await getConversationById(id, viewer);
    if (!existing) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    if (existing.assigned_to === teamMemberId) {
      return mobileData({ conversation: toMobileConversation(existing) });
    }
    if (existing.assigned_to) {
      return mobileError(
        409,
        "CONVERSATION_ALREADY_TAKEN",
        "The conversation is already assigned"
      );
    }

    await takeConversation(id, teamMemberId);
    const updated = await getConversationById(id, viewer);
    if (!updated || updated.assigned_to !== teamMemberId) {
      return mobileError(
        409,
        "CONVERSATION_TAKE_CONFLICT",
        "Another employee took the conversation first"
      );
    }
    return mobileData({ conversation: toMobileConversation(updated) });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_TAKE_FAILED",
      "Unable to take the conversation"
    );
  }
}
