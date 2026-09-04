import {
  getConversationById,
  getConversationMessages,
  MESSAGE_PAGE_SIZE,
} from "@/lib/inbox";
import { bookingReceiptOf } from "@/lib/booking-receipt";
import { toClassifiedMobileConversation } from "@/lib/mobile/conversations";
import { mobileReminderConfirmationFor } from "@/lib/mobile/reminders";
import {
  bookingRequestOf,
  routedToOf,
  sectionOf,
} from "@/lib/conversation-meta";
import {
  bestSharedLocation,
  findSharedLocationsInConversation,
} from "@/lib/location";
import { createServerSupabaseClient } from "@/lib/supabase/server";
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

    const [page, reminderConfirmation, labelIds, mobileConversation] =
      await Promise.all([
        getConversationMessages(id, { limit: MESSAGE_PAGE_SIZE }),
        mobileReminderConfirmationFor({
          customerPhone: conversation.customer_phone,
          metadata: conversation.metadata,
        }),
        getConversationLabelIds(id),
        toClassifiedMobileConversation(conversation),
      ]);

    const sharedLocations = await findSharedLocationsInConversation(
      await createServerSupabaseClient(),
      id,
      page.messages
    );

    return mobileData({
      conversation: {
        ...mobileConversation,
        reminderConfirmation,
        labelIds,
        // Detail-only: the actions sheet shows and edits these, the inbox list
        // has no use for them.
        section: sectionOf(conversation),
        routedTo: routedToOf(conversation),
        // The booking the bot collected, so the chat screen can offer
        // "تأكيد الحجز" the same way the web inbox banner does.
        bookingRequest: bookingRequestOf(conversation),
        // Stored separately from chat messages so the invoice remains attached
        // to the booking workflow even after the conversation moves forward.
        bookingReceipt: bookingReceiptOf(conversation),
      },
      messages: page.messages,
      // Prefills the booking sheet's location field. Searched across the whole
      // thread, not just this page: a pin is usually dropped once, early, and
      // the phone must not ask for an address the customer already sent.
      sharedLocation: bestSharedLocation(sharedLocations),
      sharedLocations,
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
