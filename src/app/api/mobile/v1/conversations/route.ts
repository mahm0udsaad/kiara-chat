import {
  MOBILE_CONVERSATION_VIEWS,
  type MobileConversationView,
} from "@/lib/mobile/contracts";
import { listMobileConversations } from "@/lib/mobile/conversations";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
  parseIntegerParam,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

function isView(value: string): value is MobileConversationView {
  return MOBILE_CONVERSATION_VIEWS.some((view) => view === value);
}

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const rawView = url.searchParams.get("view") ?? "new";
  if (!isView(rawView)) {
    return mobileError(
      400,
      "INVALID_VIEW",
      "view must be new, unassigned, or danger"
    );
  }

  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const offset = parseIntegerParam(url.searchParams.get("offset"), 0, 0, 500);
  const limit = parseIntegerParam(url.searchParams.get("limit"), 50, 1, 100);

  try {
    const result = await listMobileConversations({
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
      view: rawView,
      search,
      offset,
      limit,
    });
    return mobileData({
      view: rawView,
      query: search,
      counts: result.counts,
      conversations: result.page,
    });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATIONS_FAILED",
      "Unable to load conversations"
    );
  }
}
