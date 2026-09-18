import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";
import { getConversationById, hideMessage } from "@/lib/inbox";
import { authorizeMobileRequest, mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";
import { GRANTABLE_PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions-store";

/**
 * DELETE /api/mobile/v1/conversations/:id/messages/:messageId — hide one
 * message from Kiara's own thread view. See `hideMessage` in `@/lib/inbox`
 * for what this does and, importantly, does not do (nothing changes on
 * WhatsApp itself — there is no "delete for everyone" on the platform). An
 * admin may always do this; an agent needs it granted from الموظفون.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!(await hasPermission(auth.session, GRANTABLE_PERMISSIONS.deleteMessages))) {
    return mobileError(403, "FORBIDDEN", "ليست لديكِ صلاحية حذف الرسائل");
  }

  const { id, messageId } = await params;
  const viewer = { isAdmin: auth.session.role === "admin", teamMemberId: auth.session.teamMemberId };
  const conversation = await getConversationById(id, viewer);
  if (!conversation) return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

  try {
    const found = await hideMessage(id, messageId, auth.session.email ?? null);
    if (!found) return mobileError(404, "MESSAGE_NOT_FOUND", "Message not found");
    await recordConversationEvent(id, CONVERSATION_EVENTS.messageDeleted, {
      userId: auth.session.userId,
      teamMemberId: auth.session.teamMemberId,
      role: auth.session.role,
    }, { messageId });
    return mobileData({ ok: true });
  } catch (error) {
    return mobileServerError(error, "MESSAGE_DELETE_FAILED", "Unable to delete message");
  }
}
