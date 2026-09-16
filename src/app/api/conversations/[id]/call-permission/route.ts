/**
 * GET  /api/conversations/:id/call-permission — may we call, may we ask?
 * POST /api/conversations/:id/call-permission — ask.
 *
 * The cookie-session twin of the mobile route. Both are thin wrappers over the
 * same functions in `@/lib/call-permissions`; only the authentication differs,
 * and duplicating the rules instead would let the two surfaces drift on which
 * employee is allowed to ask.
 */
import { NextResponse } from "next/server";

import {
  CONVERSATION_EVENTS,
  recordConversationEvent,
} from "@/lib/audit";
import {
  recordPermissionRequested,
  resolveCallPermission,
} from "@/lib/call-permissions";
import { denyIfRouted } from "@/lib/conversation-access";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import { bumpConversationActivity, saveMessage } from "@/lib/server-conversations";
import { getKiaraSession } from "@/lib/tenant";
import { sendCallPermissionRequest } from "@/lib/transport/meta-calling";
import { getServiceWindow, isWindowClosedError } from "@/lib/transport/window";

const DEFAULT_BODY = "نود الاتصال بك لمساعدتك بشكل أسرع. هل تسمحين لنا بذلك؟";
const THREAD_NOTE = "📞 تم إرسال طلب السماح بالاتصال";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const conversation = await getConversationById(id, {
    isAdmin: session.role === "admin",
    teamMemberId: session.teamMemberId,
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const permission = await resolveCallPermission(conversation.customer_phone);
  const window = await getServiceWindow(id);

  return NextResponse.json({
    conversationId: id,
    ...permission,
    requestChannel: window.open ? "free_form" : "template",
    requestAvailable: permission.canRequest && window.open,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;

  const payload = await request.json().catch(() => ({}));
  const body =
    typeof payload?.body === "string" && payload.body.trim()
      ? payload.body.trim()
      : DEFAULT_BODY;

  const conversation = await getConversationById(id, {
    isAdmin: session.role === "admin",
    teamMemberId: session.teamMemberId,
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const denial = replyDenialFor(conversation, {
    role: session.role,
    teamMemberId: session.teamMemberId,
  });
  if (denial) {
    return NextResponse.json(
      { error: denial.message, code: denial.code },
      { status: denial.status },
    );
  }

  const permission = await resolveCallPermission(conversation.customer_phone);
  if (permission.callable) {
    return NextResponse.json(
      { error: "العميلة تسمح بالاتصال بالفعل", code: "CALL_PERMISSION_ALREADY_GRANTED" },
      { status: 409 },
    );
  }
  if (!permission.canRequest) {
    return NextResponse.json(
      {
        error:
          "لا يمكن إرسال طلب آخر الآن — يُسمح بطلب واحد كل ٢٤ ساعة وطلبين خلال ٧ أيام",
        code: "CALL_PERMISSION_RATE_LIMITED",
      },
      { status: 429 },
    );
  }

  const window = await getServiceWindow(id);
  if (!window.open) {
    return NextResponse.json(
      {
        error: "انتهت نافذة الـ٢٤ ساعة — لا يمكن طلب الإذن إلا داخلها حاليًا",
        code: "CALL_PERMISSION_WINDOW_CLOSED",
      },
      { status: 409 },
    );
  }

  try {
    const sent = await sendCallPermissionRequest(conversation.customer_phone, body);

    await recordPermissionRequested({
      customerPhone: conversation.customer_phone,
      messageSid: sent.messageSid,
      actorUserId: session.userId,
    });

    await saveMessage({
      conversationId: id,
      role: "agent",
      content: THREAD_NOTE,
      messageType: "text",
      externalMessageSid: sent.messageSid,
      metadata: {
        provider: "meta",
        meta_type: "interactive",
        call_permission_request: { body },
      },
      deliveryStatus: "sent",
    });
    // Outbound: must not move last_inbound_at, which the service window is
    // measured from.
    await bumpConversationActivity(id, { inbound: false });

    await recordConversationEvent(
      id,
      CONVERSATION_EVENTS.callPermissionRequested,
      {
        userId: session.userId,
        teamMemberId: session.teamMemberId,
        role: session.role,
      },
      { message_sid: sent.messageSid },
    );

    return NextResponse.json({ ok: true, messageSid: sent.messageSid, status: "requested" });
  } catch (error) {
    if (isWindowClosedError(error)) {
      return NextResponse.json(
        {
          error: "انتهت نافذة الـ٢٤ ساعة — لا يمكن طلب الإذن إلا داخلها حاليًا",
          code: "CALL_PERMISSION_WINDOW_CLOSED",
        },
        { status: 409 },
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[call-permissions] request on ${id} failed: ${detail}`);
    return NextResponse.json(
      { error: "تعذّر إرسال طلب الإذن", code: "CALL_PERMISSION_REQUEST_FAILED" },
      { status: 502 },
    );
  }
}
