/**
 * GET /api/mobile/v1/campaigns/audience — who a campaign would reach, and who
 * the employee may tick.
 *
 * The segment narrows by booking recency; these filters narrow by what the
 * inbox knows — label, conversation status, booking stage, contact outcome —
 * so the campaign sheet can pick an audience the same way the chat list is
 * read. The web screen has had this since the audience panel landed; this is
 * the same `listAudience` behind a mobile route. Nothing here sends.
 */
import { isBookingStage } from "@/lib/booking-stage";
import {
  isSegment,
  listAudience,
  type AudienceFilters,
  type Segment,
} from "@/lib/broadcast";
import { isContactOutcome } from "@/lib/contact-outcome";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { templateKeyForContentSid } from "@/lib/templates";
import type { CsStatus } from "@/lib/types";

export const maxDuration = 60;

const CS_STATUSES = new Set<CsStatus>(["open", "waiting", "resolved"]);

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  // Open to whoever can start a campaign. The web panel is owner-only because
  // the web campaign screen is; in the app the screen and the create route are
  // open to all staff, and narrowing an audience is the safer half of that —
  // gating only the picker would leave an employee able to send to the whole
  // segment but not to fewer people.

  const url = new URL(request.url);
  // The sheet lists whatever Twilio or Meta has approved, so it asks by content
  // SID. A template Kiara has no spec for still lists an audience — it simply
  // has no send history to skip.
  const contentSid = url.searchParams.get("contentSid") ?? "";
  if (!contentSid.trim()) {
    return mobileError(400, "TEMPLATE_REQUIRED", "اختاري قالبًا أولًا");
  }
  const key = templateKeyForContentSid(contentSid);

  const rawSegment = url.searchParams.get("segment") ?? "all";
  const segment: Segment = isSegment(rawSegment) ? rawSegment : "all";
  const status = url.searchParams.get("status");
  const bookingStage = url.searchParams.get("bookingStage");
  const contactOutcome = url.searchParams.get("contactOutcome");
  const filters: AudienceFilters = {
    labelId: url.searchParams.get("labelId") || null,
    status: status && CS_STATUSES.has(status as CsStatus) ? (status as CsStatus) : null,
    bookingStage: bookingStage && isBookingStage(bookingStage) ? bookingStage : null,
    contactOutcome:
      contactOutcome && isContactOutcome(contactOutcome) ? contactOutcome : null,
    search: url.searchParams.get("search"),
    includeSent: url.searchParams.get("includeSent") === "1",
  };

  try {
    return mobileData(await listAudience(key, segment, filters));
  } catch (error) {
    return mobileServerError(
      error,
      "CAMPAIGN_AUDIENCE_FAILED",
      "تعذّر تحميل قائمة العميلات",
    );
  }
}
