import {
  CONVERSATION_EVENTS,
  recordConversationEvents,
} from "@/lib/audit";
import { releaseAssignedConversations } from "@/lib/interactions";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

type ReleaseScope =
  | { scope: "mine" }
  | { scope: "member"; teamMemberId: string }
  | { scope: "all" };

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as ReleaseScope | null;
  if (!body || !["mine", "member", "all"].includes(body.scope)) {
    return mobileError(400, "INVALID_RELEASE_SCOPE", "طلب غير صالح");
  }

  let target: string | null;
  if (body.scope === "mine") {
    if (!auth.session.teamMemberId) {
      return mobileError(400, "TEAM_MEMBER_REQUIRED", "الحساب غير مرتبط بعضوية فريق");
    }
    target = auth.session.teamMemberId;
  } else {
    if (auth.session.role !== "admin") {
      return mobileError(403, "ADMIN_REQUIRED", "هذا الإجراء للمديرة فقط");
    }
    if (body.scope === "member") {
      if (typeof body.teamMemberId !== "string" || !body.teamMemberId) {
        return mobileError(400, "TEAM_MEMBER_REQUIRED", "الموظفة مطلوبة");
      }
      target = body.teamMemberId;
    } else {
      target = null;
    }
  }

  try {
    const released = await releaseAssignedConversations(target);
    await recordConversationEvents(
      released.map((conversation) => ({
        id: conversation.id,
        payload: {
          previousAssignee: conversation.previousAssignee,
          bulkRelease: true,
        },
      })),
      CONVERSATION_EVENTS.released,
      {
        userId: auth.session.userId,
        teamMemberId: auth.session.teamMemberId,
        role: auth.session.role,
      },
    );
    return mobileData({
      ok: true,
      count: released.length,
      conversationIds: released.map((conversation) => conversation.id),
    });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATIONS_RELEASE_FAILED",
      "تعذّر إطلاق المحادثات",
    );
  }
}
