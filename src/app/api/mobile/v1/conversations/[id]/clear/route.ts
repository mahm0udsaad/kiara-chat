import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";
import { clearConversationMessages, getConversationById } from "@/lib/inbox";
import { authorizeMobileRequest, mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";

/**
 * POST /api/mobile/v1/conversations/:id/clear — hide the whole thread from
 * Kiara's own view (nothing changes on WhatsApp — see
 * `clearConversationMessages`). Owner-only: it reads as wiping a customer's
 * history, and an employee has the per-message DELETE for a mistaken send.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (auth.session.role !== "admin") {
    return mobileError(403, "FORBIDDEN", "Owner-only action");
  }

  const { id } = await params;
  const conversation = await getConversationById(id, { isAdmin: true, teamMemberId: null });
  if (!conversation) return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

  try {
    await clearConversationMessages(id);
    await recordConversationEvent(id, CONVERSATION_EVENTS.messagesCleared, {
      userId: auth.session.userId,
      teamMemberId: auth.session.teamMemberId,
      role: auth.session.role,
    });
    return mobileData({ ok: true });
  } catch (error) {
    return mobileServerError(error, "CLEAR_FAILED", "Unable to clear conversation");
  }
}
