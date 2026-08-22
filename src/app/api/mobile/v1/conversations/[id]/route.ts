import {
  getConversationById,
  getConversationMessages,
  MESSAGE_PAGE_SIZE,
} from "@/lib/inbox";
import { toMobileConversation } from "@/lib/mobile/conversations";
import { mobileReminderConfirmationFor } from "@/lib/mobile/reminders";
import { routedToOf, sectionOf } from "@/lib/conversation-meta";
import { getConversationLabelIds } from "@/lib/labels";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/**
 * One mobile-ready conversation plus its opening message page.
 *
 * This route intentionally works without an inbox cache so notification and
 * deep-link opens receive the same routing checks as the normal list flow.
 */
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
      return mobileError(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found"
      );
    }

    const [page, reminderConfirmation, labelIds] = await Promise.all([
      getConversationMessages(id, { limit: MESSAGE_PAGE_SIZE }),
      mobileReminderConfirmationFor({
        customerPhone: conversation.customer_phone,
        metadata: conversation.metadata,
      }),
      getConversationLabelIds(id),
    ]);

    return mobileData({
      conversation: {
        ...toMobileConversation(conversation),
        reminderConfirmation,
        labelIds,
        // Detail-only: the actions sheet shows and edits these, the inbox list
        // has no use for them.
        section: sectionOf(conversation),
        routedTo: routedToOf(conversation),
      },
      messages: page.messages,
      hasMore: page.hasMore,
      nextBefore: page.hasMore ? page.messages[0]?.created_at ?? null : null,
    });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_FAILED",
      "Unable to load the conversation"
    );
  }
}
