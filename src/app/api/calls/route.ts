/**
 * POST /api/calls — place an outbound WhatsApp call.
 *
 * The browser has already built its SDP offer and finished gathering ICE
 * candidates by the time it gets here: the Calling API takes one complete SDP
 * rather than trickling candidates afterwards.
 *
 * The answer does not come back in this response. It arrives later on the
 * `calls` webhook, which broadcasts it on the call's realtime channel and
 * writes it to the row; the client picks it up from whichever arrives first.
 */
import { NextResponse } from "next/server";

import { resolveCallPermission } from "@/lib/call-permissions";
import { startOutboundCall } from "@/lib/calls";
import { denyIfRouted } from "@/lib/conversation-access";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { iceConfig } from "@/lib/ice-servers";
import { getConversationById } from "@/lib/inbox";
import { getKiaraSession } from "@/lib/tenant";
import { isMissingCallPermission } from "@/lib/transport/meta-calling";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const conversationId = (body?.conversationId as string | undefined)?.trim();
  const sdp = (body?.sdp as string | undefined)?.trim();
  if (!conversationId || !sdp) {
    return NextResponse.json(
      { error: "conversationId and sdp are both required" },
      { status: 400 },
    );
  }

  const denied = await denyIfRouted(conversationId, session);
  if (denied) return denied;

  const conversation = await getConversationById(conversationId, {
    isAdmin: session.role === "admin",
    teamMemberId: session.teamMemberId,
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Calling someone is at least as intrusive as writing to them, so it obeys
  // the same ownership rule as a reply.
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

  // Checked before dialling rather than after a 138006: Meta counts an
  // attempt without permission against the business, and the employee would
  // otherwise see a bare error code.
  const permission = await resolveCallPermission(conversation.customer_phone);
  if (!permission.callable) {
    return NextResponse.json(
      {
        error: "لم تسمح العميلة بالاتصال بعد — أرسلي طلب الإذن أولًا",
        code: "CALL_PERMISSION_REQUIRED",
        permission,
      },
      { status: 409 },
    );
  }

  try {
    const { call } = await startOutboundCall({
      conversationId,
      customerPhone: conversation.customer_phone,
      sdpOffer: sdp,
      initiatedByUserId: session.userId,
    });
    return NextResponse.json({
      ok: true,
      call,
      ice: iceConfig(session.userId),
    });
  } catch (error) {
    if (isMissingCallPermission(error)) {
      // The cached answer disagreed with Meta — treat Meta as right and put
      // the permission state back in sync for the next attempt.
      await resolveCallPermission(conversation.customer_phone, { force: true });
      return NextResponse.json(
        {
          error: "لم تسمح العميلة بالاتصال بعد — أرسلي طلب الإذن أولًا",
          code: "CALL_PERMISSION_REQUIRED",
        },
        { status: 409 },
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[calls] outbound to ${conversationId} failed: ${detail}`);
    return NextResponse.json(
      { error: "تعذّر بدء المكالمة", code: "CALL_START_FAILED" },
      { status: 502 },
    );
  }
}
