import {
  MOBILE_CONVERSATION_VIEWS,
  type MobileConversationView,
} from "@/lib/mobile/contracts";
import {
  listMobileConversations,
  type MobileConversationFilters,
} from "@/lib/mobile/conversations";
import { isBookingStage } from "@/lib/booking-stage";
import { isConversationSection } from "@/lib/conversation-meta";
import type { CsStatus } from "@/lib/types";
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

function isCsStatus(value: string): value is CsStatus {
  return value === "open" || value === "waiting" || value === "resolved";
}

/**
 * The optional refinements beside the view tabs. An unknown value is dropped
 * rather than rejected: a phone on an older build must never be able to 400
 * the inbox it lives in.
 */
function readFilters(params: URLSearchParams): MobileConversationFilters {
  const status = params.get("status") ?? "";
  const section = params.get("section") ?? "";
  const labelId = (params.get("label") ?? "").trim().slice(0, 64);
  const stage = params.get("stage") ?? "";
  return {
    status: isCsStatus(status) ? status : null,
    section: isConversationSection(section) ? section : null,
    labelId: labelId || null,
    bookingStage: isBookingStage(stage) ? stage : null,
  };
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
      "view must be new, mine, unassigned, specialists, or danger"
    );
  }

  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const offset = parseIntegerParam(url.searchParams.get("offset"), 0, 0, 500);
  const limit = parseIntegerParam(url.searchParams.get("limit"), 50, 1, 100);
  const filters = readFilters(url.searchParams);

  try {
    const result = await listMobileConversations({
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
      view: rawView,
      search,
      offset,
      limit,
      filters,
    });
    return mobileData({
      view: rawView,
      query: search,
      filters,
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
