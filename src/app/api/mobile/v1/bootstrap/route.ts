import { BOOKING_STAGE_LABEL, BOOKING_STAGE_ORDER } from "@/lib/booking-stage";
import { listAgents } from "@/lib/interactions";
import { listLabels } from "@/lib/labels";
import {
  MOBILE_API_VERSION,
  MOBILE_CONVERSATION_VIEWS,
  MOBILE_DANGER_AFTER_SECONDS,
  toMobileSession,
  fieldStaffToMobileSession,
} from "@/lib/mobile/contracts";
import {
  authorizeAnyMobileRequest,
  mobileData,
  mobileServerError,
} from "@/lib/mobile/http";
import { listSavedReplies } from "@/lib/saved-replies";

export const dynamic = "force-dynamic";

const VIEW_LABELS = {
  today: "محادثات اليوم",
  new: "جديد",
  mine: "محادثاتي",
  unassigned: "غير مستلمة",
  specialists: "الأخصائيات",
  drivers: "السائقون",
  groups: "المجموعات",
  danger: "خطر",
} as const;

export async function GET(request: Request) {
  const auth = await authorizeAnyMobileRequest(request);
  if (auth.response) return auth.response;

  try {
    if ("kind" in auth.session) {
      return mobileData({
        apiVersion: MOBILE_API_VERSION,
        session: fieldStaffToMobileSession(auth.session),
        capabilities: {
          canTakeConversations: false,
          canManageTeam: false,
          canViewOrderPrices: false,
          canViewReports: false,
        },
        inbox: { dangerAfterSeconds: MOBILE_DANGER_AFTER_SECONDS, views: [] },
        bookingStages: [],
        agents: [],
        labels: [],
        savedReplies: [],
      });
    }
    const [agents, labels, savedReplies] = await Promise.all([
      listAgents(),
      listLabels(),
      listSavedReplies(),
    ]);
    const session = auth.session;

    return mobileData({
      apiVersion: MOBILE_API_VERSION,
      session: toMobileSession(session),
      capabilities: {
        canTakeConversations: Boolean(session.teamMemberId),
        canManageTeam: session.role === "admin",
        canViewOrderPrices: session.role === "admin",
        canViewReports: session.isOwner,
      },
      inbox: {
        dangerAfterSeconds: MOBILE_DANGER_AFTER_SECONDS,
        views: MOBILE_CONVERSATION_VIEWS.map((id) => ({
          id,
          label: VIEW_LABELS[id],
        })),
      },
      bookingStages: BOOKING_STAGE_ORDER.map((id) => ({
        id,
        label: BOOKING_STAGE_LABEL[id],
      })),
      agents,
      labels,
      savedReplies,
    });
  } catch (error) {
    return mobileServerError(
      error,
      "BOOTSTRAP_FAILED",
      "Unable to load the mobile session"
    );
  }
}
