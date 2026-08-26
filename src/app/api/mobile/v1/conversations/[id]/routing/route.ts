import { getConversationById } from "@/lib/inbox";
import { setConversationRouting } from "@/lib/interactions";
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
 * PUT /api/mobile/v1/conversations/:id/routing — owner-only exclusive routing.
 *
 * A routed chat vanishes from every other employee's inbox, which is also what
 * stops it notifying them. That is a blunt instrument, so it stays with the
 * owner: `role !== "admin"` is refused here exactly as on the web route.
 *
 * Body: { targetTeamMemberId: string | null } — null clears the route.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (auth.session.role !== "admin") {
    return mobileError(403, "ADMIN_REQUIRED", "التوجيه الحصري للمديرة فقط");
  }

  const body = (await request.json().catch(() => null)) as {
    targetTeamMemberId?: unknown;
  } | null;
  const target =
    typeof body?.targetTeamMemberId === "string"
      ? body.targetTeamMemberId.trim() || null
      : null;

  const { id } = await params;
  const viewer = { isAdmin: true, teamMemberId: auth.session.teamMemberId };

  try {
    const conversation = await getConversationById(id, viewer);
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }

    // Routing to a non-member would hide the chat from everyone, including the
    // person it was meant for.
    if (target) {
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
    }

    const updated = await setConversationRouting(id, target);
    return mobileData({
      conversation: await toClassifiedMobileConversation(
        updated ?? conversation,
      ),
    });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_ROUTING_FAILED",
      "تعذّر تحديث توجيه المحادثة",
    );
  }
}
