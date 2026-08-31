import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";
import { isConversationSection, sectionOf } from "@/lib/conversation-meta";
import { getConversationById } from "@/lib/inbox";
import { setConversationSection } from "@/lib/interactions";
import { toClassifiedMobileConversation } from "@/lib/mobile/conversations";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

/**
 * PUT /api/mobile/v1/conversations/:id/section — file the chat under
 * قسم الطلبات / قسم الردود, or clear it. Owner-only, as on the web.
 *
 * Body: { section: "orders" | "replies" | null }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (auth.session.role !== "admin") {
    return mobileError(403, "ADMIN_REQUIRED", "تحديد القسم للمديرة فقط");
  }

  const body = (await request.json().catch(() => null)) as {
    section?: unknown;
  } | null;
  const raw = body?.section ?? null;
  if (raw !== null && !isConversationSection(raw)) {
    return mobileError(400, "INVALID_SECTION", "قسم غير معروف");
  }

  const { id } = await params;
  const viewer = { isAdmin: true, teamMemberId: auth.session.teamMemberId };

  try {
    const conversation = await getConversationById(id, viewer);
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    const previous = sectionOf(conversation);
    const updated = await setConversationSection(id, raw);
    if (previous !== raw) {
      await recordConversationEvent(
        id,
        CONVERSATION_EVENTS.sectionChanged,
        {
          userId: auth.session.userId,
          teamMemberId: auth.session.teamMemberId,
          role: auth.session.role,
        },
        { from: previous, to: raw },
      );
    }
    return mobileData({
      conversation: await toClassifiedMobileConversation(
        updated ?? conversation,
      ),
    });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_SECTION_FAILED",
      "تعذّر تحديد قسم المحادثة",
    );
  }
}
