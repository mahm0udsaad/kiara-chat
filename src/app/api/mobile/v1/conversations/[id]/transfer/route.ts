import { getConversationById } from "@/lib/inbox";
import { transferConversation } from "@/lib/interactions";
import { toClassifiedMobileConversation } from "@/lib/mobile/conversations";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

/**
 * POST /api/mobile/v1/conversations/:id/transfer — hand this thread to a
 * named colleague, in one step.
 *
 * Distinct from release: release drops the thread back into the shared queue
 * and hopes; a transfer says who is taking it. It goes through the same atomic
 * `claim_conversation` RPC the web dashboard uses, so two employees pressing at
 * once cannot both win.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const teamMemberId = auth.session.teamMemberId;
  if (!teamMemberId) {
    return mobileError(
      403,
      "TEAM_MEMBER_REQUIRED",
      "This account cannot transfer conversations",
    );
  }

  const body = (await request.json().catch(() => null)) as {
    targetTeamMemberId?: unknown;
  } | null;
  const target =
    typeof body?.targetTeamMemberId === "string"
      ? body.targetTeamMemberId.trim()
      : "";
  if (!target) {
    return mobileError(400, "TARGET_REQUIRED", "اختاري الموظفة المستلمة");
  }
  if (target === teamMemberId) {
    return mobileError(400, "TARGET_IS_SELF", "المحادثة لديكِ بالفعل");
  }

  const { id } = await params;
  const isAdmin = auth.session.role === "admin";
  const viewer = { isAdmin, teamMemberId };

  try {
    const conversation = await getConversationById(id, viewer);
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    // Handing on a thread you do not hold is a takeover wearing a friendlier
    // name, and takeover is the endpoint that records a reason for it.
    if (!isAdmin && conversation.assigned_to !== teamMemberId) {
      return mobileError(
        conversation.assigned_to ? 403 : 409,
        conversation.assigned_to
          ? "CONVERSATION_ASSIGNED_TO_ANOTHER_EMPLOYEE"
          : "CONVERSATION_NOT_TAKEN",
        conversation.assigned_to
          ? "Only the assigned employee can transfer the conversation"
          : "Take the conversation before transferring it",
      );
    }

    // Transferring to someone who is not on the team would strand the thread.
    const { data: member } = await getAdminSupabaseClient()
      .from("team_members")
      .select("id")
      .eq("id", target)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("is_active", true)
      .maybeSingle();
    if (!member) {
      return mobileError(400, "UNKNOWN_TEAM_MEMBER", "الموظفة غير موجودة");
    }

    await transferConversation(id, teamMemberId, target);
    const updated = await getConversationById(id, viewer);
    return mobileData({
      conversation: await toClassifiedMobileConversation(
        updated ?? conversation,
      ),
    });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_TRANSFER_FAILED",
      "تعذّر تحويل المحادثة",
    );
  }
}
