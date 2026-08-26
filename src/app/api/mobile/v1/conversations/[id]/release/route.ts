import { getConversationById } from "@/lib/inbox";
import { releaseConversation } from "@/lib/interactions";
import { toClassifiedMobileConversation } from "@/lib/mobile/conversations";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

/**
 * POST /api/mobile/v1/conversations/:id/release — hand the thread back.
 *
 * The counterpart to `take`, and the honest way out of a conversation an
 * employee cannot finish: releasing returns it to the unassigned queue where
 * someone else can pick it up, rather than leaving it parked on a phone that
 * has gone home. Only the holder or an admin may release — taking a thread off
 * a colleague is `takeover`, which demands a reason.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const isAdmin = auth.session.role === "admin";
  const viewer = { isAdmin, teamMemberId: auth.session.teamMemberId };

  try {
    const conversation = await getConversationById(id, viewer);
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    if (!conversation.assigned_to) {
      return mobileData({
        conversation: await toClassifiedMobileConversation(conversation),
      });
    }
    if (!isAdmin && conversation.assigned_to !== auth.session.teamMemberId) {
      return mobileError(
        403,
        "CONVERSATION_ASSIGNED_TO_ANOTHER_EMPLOYEE",
        "Only the assigned employee can release the conversation",
      );
    }

    await releaseConversation(id);
    const updated = await getConversationById(id, viewer);
    return mobileData({
      conversation: await toClassifiedMobileConversation(
        updated ?? conversation,
      ),
    });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_RELEASE_FAILED",
      "تعذّر إطلاق المحادثة",
    );
  }
}
