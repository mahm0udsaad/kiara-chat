/**
 * POST /api/mobile/v1/calls — place an outbound WhatsApp call from the app.
 *
 * The device has already built its SDP offer and finished gathering ICE
 * candidates by the time it gets here: the Calling API takes one complete SDP
 * rather than trickling candidates afterwards.
 *
 * The answer does not come back in this response. It arrives later on the
 * `calls` webhook, which broadcasts it on the call's realtime channel and
 * writes it to the row; the device takes whichever arrives first.
 *
 * Mirrors the web route deliberately — same ownership rule, same permission
 * pre-check, same recovery when Meta disagrees with our cached permission.
 * Only the envelope and the auth transport differ.
 */
import { resolveCallPermission } from "@/lib/call-permissions";
import { startOutboundCall } from "@/lib/calls";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { isMissingCallPermission } from "@/lib/transport/meta-calling";

export const runtime = "nodejs";

/** Shown when permission is missing, on both the pre-check and Meta's own 138006. */
const PERMISSION_REQUIRED =
  "لم تسمح العميلة بالاتصال بعد — أرسلي طلب الإذن أولًا";

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload: unknown = await request.json().catch(() => null);
  const record =
    payload && typeof payload === "object"
      ? (payload as { conversationId?: unknown; sdp?: unknown })
      : {};
  const conversationId =
    typeof record.conversationId === "string" ? record.conversationId.trim() : "";
  const sdp = typeof record.sdp === "string" ? record.sdp.trim() : "";

  if (!conversationId || !sdp) {
    return mobileError(
      400,
      "CALL_INVALID_REQUEST",
      "conversationId and sdp are both required",
    );
  }

  try {
    // `getConversationById` applies the routing filter for this viewer, so a
    // conversation routed to another employee reads as absent rather than
    // needing a separate guard.
    const conversation = await getConversationById(conversationId, {
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
    });
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }

    // Calling someone is at least as intrusive as writing to them, so it obeys
    // the same ownership rule as a reply.
    const denial = replyDenialFor(conversation, {
      role: auth.session.role,
      teamMemberId: auth.session.teamMemberId,
    });
    if (denial) return mobileError(denial.status, denial.code, denial.message);

    // Checked before dialling rather than after a 138006: Meta counts an
    // attempt without permission against the business, and the employee would
    // otherwise see a bare error code.
    const permission = await resolveCallPermission(conversation.customer_phone);
    if (!permission.callable) {
      return mobileError(409, "CALL_PERMISSION_REQUIRED", PERMISSION_REQUIRED);
    }

    try {
      const { call } = await startOutboundCall({
        conversationId,
        customerPhone: conversation.customer_phone,
        sdpOffer: sdp,
        initiatedByUserId: auth.session.userId,
      });
      return mobileData({ call });
    } catch (error) {
      if (isMissingCallPermission(error)) {
        // The cached answer disagreed with Meta — treat Meta as right and put
        // the permission state back in sync for the next attempt.
        await resolveCallPermission(conversation.customer_phone, { force: true });
        return mobileError(409, "CALL_PERMISSION_REQUIRED", PERMISSION_REQUIRED);
      }
      throw error;
    }
  } catch (error) {
    return mobileServerError(error, "CALL_START_FAILED", "تعذّر بدء المكالمة");
  }
}
