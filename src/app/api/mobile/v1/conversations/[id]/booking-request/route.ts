import { clearBookingRequest } from "@/lib/dispatch";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export const runtime = "nodejs";

/**
 * Dismiss the bot-collected booking without creating an order (she changed her
 * mind, it was handled by phone, it is a duplicate). Confirming the booking
 * clears it on its own — this is the other exit, and the only one the phone
 * offers beside it.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;

  try {
    const conversation = await getConversationById(id, {
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
    });
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    const denial = replyDenialFor(conversation, {
      role: auth.session.role,
      teamMemberId: auth.session.teamMemberId,
    });
    if (denial) {
      return mobileError(denial.status, denial.code, denial.message);
    }

    await clearBookingRequest(id);
    return mobileData({ ok: true });
  } catch (error) {
    return mobileServerError(
      error,
      "BOOKING_REQUEST_DISMISS_FAILED",
      "تعذّر إخفاء طلب الحجز"
    );
  }
}
