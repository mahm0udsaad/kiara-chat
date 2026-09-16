/**
 * Call permission for one conversation.
 *
 *   GET  — may we call this customer right now, and may we ask?
 *   POST — ask her.
 *
 * Asking is capped by Meta at 1 request per 24 hours and 2 per 7 days per
 * customer, so the GET exists to keep the button honest: a UI that offers the
 * ask unconditionally produces failures the customer never sees and the
 * employee cannot explain.
 */
import {
  CONVERSATION_EVENTS,
  recordConversationEvent,
} from "@/lib/audit";
import {
  recordPermissionRequested,
  resolveCallPermission,
} from "@/lib/call-permissions";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { bumpConversationActivity, saveMessage } from "@/lib/server-conversations";
import { sendCallPermissionRequest } from "@/lib/transport/meta-calling";
import { getServiceWindow, isWindowClosedError } from "@/lib/transport/window";

/** Shown to the customer above WhatsApp's own fixed accept/decline buttons. */
const DEFAULT_BODY = "نود الاتصال بك لمساعدتك بشكل أسرع. هل تسمحين لنا بذلك؟";

/** What staff see in the thread after asking. */
const THREAD_NOTE = "📞 تم إرسال طلب السماح بالاتصال";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
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

    const permission = await resolveCallPermission(conversation.customer_phone);
    const window = await getServiceWindow(id);

    return mobileData({
      conversationId: id,
      ...permission,
      // Outside the 24-hour window a permission request has to go as an
      // approved template, which this account does not have yet. Say so here
      // rather than letting the POST fail with a Meta error code.
      requestChannel: window.open ? "free_form" : "template",
      requestAvailable: permission.canRequest && window.open,
    });
  } catch (error) {
    return mobileServerError(
      error,
      "CALL_PERMISSION_READ_FAILED",
      "Unable to read call permission",
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload: unknown = await request.json().catch(() => null);
  const record =
    payload && typeof payload === "object" ? (payload as { body?: unknown }) : {};
  const body =
    typeof record.body === "string" && record.body.trim()
      ? record.body.trim()
      : DEFAULT_BODY;

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

    // Asking to call is a message into the customer's thread, so it obeys the
    // same ownership rule as any other reply.
    const denial = replyDenialFor(conversation, {
      role: auth.session.role,
      teamMemberId: auth.session.teamMemberId,
    });
    if (denial) return mobileError(denial.status, denial.code, denial.message);

    const permission = await resolveCallPermission(conversation.customer_phone);
    if (permission.callable) {
      return mobileError(
        409,
        "CALL_PERMISSION_ALREADY_GRANTED",
        "العميلة تسمح بالاتصال بالفعل",
      );
    }
    if (!permission.canRequest) {
      return mobileError(
        429,
        "CALL_PERMISSION_RATE_LIMITED",
        "لا يمكن إرسال طلب آخر الآن — يُسمح بطلب واحد كل ٢٤ ساعة وطلبين خلال ٧ أيام",
      );
    }

    const window = await getServiceWindow(id);
    if (!window.open) {
      return mobileError(
        409,
        "CALL_PERMISSION_WINDOW_CLOSED",
        "انتهت نافذة الـ٢٤ ساعة — لا يمكن طلب الإذن إلا داخلها حاليًا",
      );
    }

    let messageSid: string;
    try {
      const sent = await sendCallPermissionRequest(conversation.customer_phone, body);
      messageSid = sent.messageSid;
    } catch (error) {
      if (isWindowClosedError(error)) {
        return mobileError(
          409,
          "CALL_PERMISSION_WINDOW_CLOSED",
          "انتهت نافذة الـ٢٤ ساعة — لا يمكن طلب الإذن إلا داخلها حاليًا",
        );
      }
      throw error;
    }

    await recordPermissionRequested({
      customerPhone: conversation.customer_phone,
      messageSid,
      actorUserId: auth.session.userId,
    });

    // The ask is visible in the thread, so the next employee to open it can
    // see that permission is already pending rather than asking again and
    // burning the 24-hour allowance.
    await saveMessage({
      conversationId: id,
      role: "agent",
      content: THREAD_NOTE,
      messageType: "text",
      externalMessageSid: messageSid,
      metadata: {
        provider: "meta",
        meta_type: "interactive",
        call_permission_request: { body },
      },
      deliveryStatus: "sent",
    });
    // Outbound: this must not move `last_inbound_at`, which is what the
    // 24-hour service window is measured from.
    await bumpConversationActivity(id, { inbound: false });

    await recordConversationEvent(
      id,
      CONVERSATION_EVENTS.callPermissionRequested,
      {
        userId: auth.session.userId,
        teamMemberId: auth.session.teamMemberId,
        role: auth.session.role,
      },
      { message_sid: messageSid },
    );

    return mobileData({
      conversationId: id,
      messageSid,
      status: "requested",
    });
  } catch (error) {
    return mobileServerError(
      error,
      "CALL_PERMISSION_REQUEST_FAILED",
      "Unable to request call permission",
    );
  }
}
